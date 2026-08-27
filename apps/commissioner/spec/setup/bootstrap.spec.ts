import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BootstrapService, deriveLegalStage } from "../../src/application/bootstrap/bootstrap-service.js";
import { LifecycleState } from "../../src/application/ports/season-repository.js";
import { openSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";
import { startCommissionerServer } from "../../src/server/startup.js";

const actor = { type: "COMMISSIONER", label: "Bootstrap spec" };

describe("season bootstrap", () => {
  const stores: Array<{ close(): Promise<void> }> = [];
  const servers: Array<{ stop(): Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.stop()));
    await Promise.all(stores.splice(0).map(store => store.close()));
  });

  it.each([
    [LifecycleState.SETUP, false, "SETUP"],
    [LifecycleState.SETUP, true, "KEEPERS"],
    [LifecycleState.KEEPERS_LOCKED, true, "AUCTION_1"],
    [LifecycleState.R1_REVIEW, true, "AUCTION_1"],
    [LifecycleState.R1_PUBLISHED, true, "AUCTION_2"],
    [LifecycleState.R2_REVIEW, true, "AUCTION_2"],
    [LifecycleState.R2_PUBLISHED, true, "DRAFT_ORDER"],
    [LifecycleState.ORDER_TIE_PAUSED, true, "DRAFT_ORDER"],
    [LifecycleState.ORDER_FINAL, true, "DRAFT"],
    [LifecycleState.CONVENTIONAL_DRAFT, true, "DRAFT"],
    [LifecycleState.COMPLETED, true, "RESULTS"],
  ] as const)("maps %s with setupReady=%s to %s", (state, setupReady, expected) => {
    expect(deriveLegalStage(state, setupReady)).toBe(expected);
  });

  it("returns readiness and all existing phase summaries with one season version", async () => {
    const store = await openSeasonStore(join(await mkdtemp(join(tmpdir(), "bootstrap-")), "commissioner.db"));
    stores.push(store);
    await store.execute({ actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    const result = await new BootstrapService(store).load(actor, "s");
    expect(result).toMatchObject({ legalStage: "SETUP", readiness: { setupReady: false, keepersLocked: false }, season: { id: "s", rowVersion: 0 }, phases: { auctionOne: null, auctionTwo: null, draft: null } });
    expect(result.setup.season.rowVersion).toBe(result.season.rowVersion);
  });

  it("serializes a bootstrap racing a mutation into a coherent old-or-new snapshot", async () => {
    const store = await openSeasonStore(join(await mkdtemp(join(tmpdir(), "bootstrap-race-")), "commissioner.db"));
    stores.push(store);
    await store.execute({ actor, seasonId: "race", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx => tx.createSeason({ id: "race", leagueId: "race-league", year: 2026, name: "Race", teamCount: 1 }));
    const bootstrap = new BootstrapService(store);
    const [snapshot] = await Promise.all([
      bootstrap.load(actor, "race"),
      store.configureTeams({ actor, seasonId: "race", idempotencyKey: "teams", commandType: "CONFIGURE_TEAMS", expectedVersion: 0 }, [{ id: "team", displayName: "Team", seedOrder: 1 }]),
    ]);
    const coherentOld = snapshot.season.rowVersion === 0 && snapshot.setup.teams.length === 0 && snapshot.readiness.teamsReady === false;
    const coherentNew = snapshot.season.rowVersion === 1 && snapshot.setup.teams.length === 1 && snapshot.readiness.teamsReady === true;
    expect(coherentOld || coherentNew).toBe(true);
    expect(snapshot.setup.season.rowVersion).toBe(snapshot.season.rowVersion);
  });

  it("serves the coherent bootstrap through one HTTP read", async () => {
    const server = await startCommissionerServer({ port: 0, dataDirectory: await mkdtemp(join(tmpdir(), "bootstrap-http-")) });
    servers.push(server);
    const base = `http://${server.address.host}:${server.address.port}`;
    await fetch(`${base}/api/setup/seasons`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "create" }, body: JSON.stringify({ seasonId: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }) });
    const response = await fetch(`${base}/api/bootstrap/s`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ legalStage: "SETUP", season: { id: "s", rowVersion: 0 } });
  });
});
