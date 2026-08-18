import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";

const actor = { type: "LOCAL_COMMISSIONER", label: "Commissioner" } as const;
const meta = (seasonId: string, idempotencyKey: string, commandType: string, expectedVersion?: number) => ({ actor, seasonId, idempotencyKey, commandType, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
async function fresh() { return openSeasonStore(join(await mkdtemp(join(tmpdir(), "commissioner-u3-")), "draft.db")); }

describe("season setup through keeper lock", () => {
  it("imports, prices, preserves a custom K, and creates $350/$300 budgets", async () => {
    const store = await fresh();
    await store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "2026", teamCount: 2 }));
    await store.configureTeams(meta("s", "teams", "CONFIGURE_TEAMS"), [{ id: "a", displayName: "Alpha", seedOrder: 1 }, { id: "b", displayName: "Beta", seedOrder: 2 }]);
    await store.addCustomPlayer(meta("s", "eddie", "ADD_CUSTOM_PLAYER"), { id: "eddie", name: "Eddie Gallagher", position: "K", sourceType: "LEAGUE_CUSTOM" });
    const preview = await store.previewImport(actor, "s", "nfl-2026", "externalId,name,position,minimumBid,ignored\n1,Josh Allen,QB,7,x\n2,Justin Jefferson,WR,,x", "csv");
    expect(preview).toMatchObject({ errors: [], reviews: [], noOp: false });
    await store.commitImport(meta("s", "import", "COMMIT_IMPORT"), "nfl-2026", "csv", preview);
    await store.setPriceFloors(meta("s", "floors", "SET_PRICE_FLOORS"), { QB: 3, WR: 2, K: 1 });
    const before = await store.setupSummary(actor, "s");
    await store.setKeeperEligibility(meta("s", "eligibility", "SET_KEEPER_ELIGIBILITY"), [before.players.find(p => p.name === "Justin Jefferson")!.id]);
    await store.selectKeeper(meta("s", "keeper", "SELECT_KEEPER"), before.teams[1]!.seasonTeamId, before.players.find(p => p.name === "Justin Jefferson")!.id);
    const locked = await store.lockKeepers(meta("s", "lock", "LOCK_KEEPERS", (await store.setupSummary(actor, "s")).season.rowVersion), 14);
    expect(locked.teams.map(team => team.startingBudget)).toEqual([350, 300]);
    expect(locked.players.find(player => player.name === "Eddie Gallagher")).toMatchObject({ position: "K", available: true, minimumBid: 1 });
    await expect(store.addCustomPlayer(meta("s", "late", "ADD_CUSTOM_PLAYER"), { id: "late", name: "Late", position: "K", sourceType: "LEAGUE_CUSTOM" })).rejects.toThrow(/locked/i);
    await store.close();
  });

  it("reports row errors before commit and makes identical imports no-ops", async () => {
    const store = await fresh();
    await store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "2026", teamCount: 1 }));
    const bad = await store.previewImport(actor, "s", "nfl", "externalId,name,position\n1,,QB\n2,Somebody,P\n3,Wrong Defense,DEF", "csv");
    expect(bad.errors).toHaveLength(3);
    await expect(store.commitImport(meta("s", "bad", "COMMIT_IMPORT"), "nfl", "csv", bad)).rejects.toThrow(/validation/i);
    const good = await store.previewImport(actor, "s", "nfl", JSON.stringify([{ externalId: "1", name: "A", position: "QB", extra: true }]), "json");
    await store.commitImport(meta("s", "good", "COMMIT_IMPORT"), "nfl", "json", good);
    expect((await store.previewImport(actor, "s", "nfl", JSON.stringify([{ externalId: "1", name: "A", position: "QB", extra: true }]), "json")).noOp).toBe(true);
    await store.close();
  });

  it("supersedes corrected batches and requires explicit review for identity changes", async () => {
    const store = await fresh();
    await store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "2026", teamCount: 1 }));
    const first = await store.previewImport(actor, "s", "nfl", JSON.stringify([{ externalId: "1", name: "Player One", position: "RB" }]), "json");
    await store.commitImport(meta("s", "first", "COMMIT_IMPORT"), "nfl", "json", first);
    const changed = await store.previewImport(actor, "s", "nfl", JSON.stringify([{ externalId: "2", name: "Player One", position: "RB" }]), "json");
    expect(changed.reviews[0]?.kind).toBe("EXTERNAL_ID_CHANGE");
    await expect(store.commitImport(meta("s", "blocked", "COMMIT_IMPORT"), "nfl", "json", changed)).rejects.toThrow(/review/i);
    await store.commitImport(meta("s", "approved", "COMMIT_IMPORT"), "nfl", "json", { ...changed, reviewsApproved: true });
    const players = (await store.setupSummary(actor, "s")).players;
    expect(players.find(player => player.externalId === "1")?.available).toBe(false);
    expect(players.find(player => player.externalId === "2")?.available).toBe(true);
    await store.close();
  });
});
