import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { SetupService } from "../../src/application/setup/setup-service.js";
import { openSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";
import { registerErrorEnvelope } from "../../src/routes/error-envelope.js";
import { registerSetupRoutes } from "../../src/routes/setup/setup-routes.js";

const actor = { type: "LOCAL_COMMISSIONER", label: "Commissioner" } as const;
const meta = (key: string, version?: number) => ({ actor, seasonId: "s", idempotencyKey: key, commandType: key, ...(version === undefined ? {} : { expectedVersion: version }) });

async function fixture(teamCount = 2) {
  const path = join(await mkdtemp(join(tmpdir(), "commissioner-keepers-")), "draft.db");
  const store = await openSeasonStore(path);
  await store.execute({ actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount }));
  const teamNames = ["Alpha", "Beta", "Gamma"];
  await store.configureTeams(meta("teams"), Array.from({ length: teamCount }, (_, index) => ({ id: `team-${index + 1}`, displayName: teamNames[index] ?? `Team ${index + 1}`, seedOrder: index + 1 })));
  await store.addCustomPlayer(meta("custom"), { id: "eddie", name: "Eddie Gallagher", position: "K", sourceType: "LEAGUE_CUSTOM" });
  const preview = await store.previewImport(actor, "s", "nfl", JSON.stringify([{ externalId: "jj", name: "Justin Jefferson", position: "WR", nflTeam: "MIN" }]), "json");
  await store.commitImport(meta("catalog"), "nfl", "json", preview);
  await store.setPriceFloors(meta("floors"), { K: 1, WR: 2 });
  const setup = await store.setupSummary(actor, "s");
  const justin = setup.players.find(player => player.name === "Justin Jefferson")!;
  await store.setKeeperEligibility(meta("eligibility"), ["eddie", justin.id]);
  return { path, store, setup: await store.setupSummary(actor, "s"), justin };
}

describe("keeper stage read model", () => {
  it("shows every team, selected-player context, keeper cost, budgets, and missing-team preflight", async () => {
    const { path, store, setup } = await fixture(3);
    await store.selectKeeper(meta("keeper"), setup.teams[0]!.seasonTeamId, "eddie");
    await store.close();
    const database = new Database(path);
    database.prepare("DELETE FROM SeasonTeam WHERE displayName='Gamma'").run();
    database.close();
    const restarted = await openSeasonStore(path);
    const summary = await restarted.keeperSummary(actor, "s");
    expect(summary.teams).toEqual([
      expect.objectContaining({ displayName: "Alpha", keeperCost: 50, startingBudget: 300, selectedPlayer: expect.objectContaining({ name: "Eddie Gallagher", sourceType: "LEAGUE_CUSTOM", minimumBid: 1, valid: true }) }),
      expect.objectContaining({ displayName: "Beta", keeperCost: 0, startingBudget: 350 }),
    ]);
    expect(summary.preflight).toEqual({ expectedTeamCount: 3, configuredTeamCount: 2, missingTeamCount: 1, invalidSelectionCount: 0, missingPriceCount: 0, unresolvedPriceReviewCount: 0, canLock: false });
    await restarted.close();
  });

  it("changes and clears selections, and rejects selecting the same player twice", async () => {
    const { store, setup, justin } = await fixture();
    await store.selectKeeper(meta("alpha-keeper"), setup.teams[0]!.seasonTeamId, "eddie");
    await expect(store.selectKeeper(meta("duplicate"), setup.teams[1]!.seasonTeamId, "eddie")).rejects.toThrow(/already selected/i);
    await store.selectKeeper(meta("change"), setup.teams[0]!.seasonTeamId, justin.id);
    expect((await store.keeperSummary(actor, "s")).teams[0]!.selectedPlayer?.name).toBe("Justin Jefferson");
    await store.selectKeeper(meta("clear"), setup.teams[0]!.seasonTeamId);
    expect((await store.keeperSummary(actor, "s")).teams[0]!.selectedPlayer).toBeUndefined();
    await store.setKeeperEligibility(meta("eligibility-reduced"), ["eddie"]);
    await expect(store.selectKeeper(meta("ineligible"), setup.teams[0]!.seasonTeamId, justin.id)).rejects.toThrow(/unavailable/i);
    await store.close();
  });

  it("locks an explicitly reviewed zero-keeper season and reports unresolved price preflight", async () => {
    const zero = await fixture();
    const zeroSummary = await zero.store.keeperSummary(actor, "s");
    expect(zeroSummary.preflight.canLock).toBe(true);
    expect((await zero.store.lockKeepers(meta("zero-lock", zeroSummary.season.rowVersion), 14)).teams.map(team => team.startingBudget)).toEqual([350, 350]);
    await zero.store.close();

    const store = await openSeasonStore(join(await mkdtemp(join(tmpdir(), "commissioner-keeper-price-")), "draft.db"));
    await store.execute({ actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    await store.configureTeams(meta("one-team"), [{ id: "a", displayName: "Alpha", seedOrder: 1 }]);
    await store.addCustomPlayer(meta("unpriced"), { id: "unpriced", name: "Unpriced Player", position: "K", sourceType: "LEAGUE_CUSTOM" });
    const summary = await store.keeperSummary(actor, "s");
    expect(summary.preflight).toMatchObject({ missingPriceCount: 1, canLock: false });
    await expect(store.lockKeepers(meta("unpriced-lock", summary.season.rowVersion), 14)).rejects.toThrow(/missing positional floor/i);
    await store.close();
  });

  it("preserves a valid selected keeper in the locked read model after restart", async () => {
    const { path, store, setup } = await fixture();
    await store.selectKeeper(meta("keeper"), setup.teams[0]!.seasonTeamId, "eddie");
    const beforeLock = await store.keeperSummary(actor, "s");
    await store.lockKeepers(meta("lock", beforeLock.season.rowVersion), 14);
    await store.close();
    const restarted = await openSeasonStore(path);
    const locked = await restarted.keeperSummary(actor, "s");
    expect(locked.locked).toBe(true);
    expect(locked.teams[0]!.selectedPlayer).toMatchObject({ name: "Eddie Gallagher", valid: true });
    expect(locked.preflight.invalidSelectionCount).toBe(0);
    await restarted.close();
  });

  it("surfaces a selected keeper that later becomes provider-inactive and blocks lock", async () => {
    const { path, store, setup, justin } = await fixture();
    await store.selectKeeper(meta("keeper"), setup.teams[0]!.seasonTeamId, justin.id);
    await store.close();
    const database = new Database(path);
    database.prepare("UPDATE Player SET providerActive=0, available=0 WHERE id=?").run(justin.id);
    database.close();
    const restarted = await openSeasonStore(path);
    const summary = await restarted.keeperSummary(actor, "s");
    expect(summary.teams[0]!.selectedPlayer).toMatchObject({ name: "Justin Jefferson", availabilityReason: "CATALOG_INACTIVE", valid: false });
    expect(summary.preflight).toMatchObject({ invalidSelectionCount: 1, canLock: false });
    await expect(restarted.lockKeepers(meta("lock", summary.season.rowVersion), 14)).rejects.toThrow(/invalid keeper selection/i);
    await restarted.close();
  });

  it("delivers the read model and stable stale-tab rejection through setup routes", async () => {
    const { store, setup } = await fixture();
    const server = Fastify();
    registerErrorEnvelope(server);
    await registerSetupRoutes(server, new SetupService(store, store));
    const summary = await server.inject({ method: "GET", url: "/api/setup/s/keepers" });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ keeperCost: 50, eligiblePlayers: expect.arrayContaining([expect.objectContaining({ name: "Eddie Gallagher" })]), teams: [{ displayName: "Alpha" }, { displayName: "Beta" }] });
    const version = setup.season.rowVersion;
    const selected = await server.inject({ method: "PUT", url: `/api/setup/s/teams/${setup.teams[0]!.seasonTeamId}/keeper`, headers: { "idempotency-key": "select", "x-expected-season-version": String(version) }, payload: { playerId: "eddie" } });
    expect(selected.statusCode).toBe(200);
    const stale = await server.inject({ method: "PUT", url: `/api/setup/s/teams/${setup.teams[0]!.seasonTeamId}/keeper`, headers: { "idempotency-key": "stale-clear", "x-expected-season-version": String(version) }, payload: {} });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "STALE_VERSION" });
    await server.close();
    await store.close();
  });
});
