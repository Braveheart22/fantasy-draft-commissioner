import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuctionService } from "../../src/application/auction/auction-service.js";
import { SetupService } from "../../src/application/setup/setup-service.js";
import { auctionEngineAdapter } from "../../src/integrations/auction-engine-adapter.js";
import { openSeasonStore, type PrismaSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";

const actor = { type: "LOCAL_COMMISSIONER", label: "Commissioner" } as const;
const rules = { positionLimits: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 }, flexEligiblePositions: ["RB", "WR", "TE"], flexCapacity: 1 };
let serial = 0; const meta = (seasonId: string, commandType: string) => ({ actor, seasonId, commandType, idempotencyKey: `${commandType}-${++serial}` });
const opened: Array<{ store: PrismaSeasonStore; directory: string }> = [];
afterEach(async () => { while (opened.length) { const item = opened.pop()!; await item.store.close(); await rm(item.directory, { recursive: true, force: true }); } });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "commissioner-u4-")); const store = await openSeasonStore(join(directory, "draft.db")); opened.push({ store, directory }); const setup = new SetupService(store, store); const seasonId = `season-${serial}`;
  await setup.createSeason(meta(seasonId, "CREATE"), { seasonId, leagueId: `league-${serial}`, year: 2026, name: "Test", teamCount: 2 });
  await setup.configureTeams(meta(seasonId, "TEAMS"), [{ id: "alpha", displayName: "Alpha", seedOrder: 1 }, { id: "beta", displayName: "Beta", seedOrder: 2 }]);
  await setup.addCustomPlayer(meta(seasonId, "PLAYER1"), { id: "p1", name: "One", position: "K", sourceType: "LEAGUE_CUSTOM" }); await setup.addCustomPlayer(meta(seasonId, "PLAYER2"), { id: "p2", name: "Two", position: "K", sourceType: "LEAGUE_CUSTOM" });
  await setup.setPriceFloors(meta(seasonId, "FLOORS"), { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 }); await setup.lockKeepers(meta(seasonId, "LOCK_KEEPERS"), 14);
  return { store, seasonId, auction: new AuctionService(store, auctionEngineAdapter) };
}

describe("auction orchestration", () => {
  it("masks submissions, requires all-team finalization, reveals after lock, publishes atomically, and derives round-two budgets", async () => {
    const { store, seasonId, auction } = await fixture(); const openedRound = await auction.open(meta(seasonId, "OPEN_R1"), 1); const [alpha, beta] = openedRound.teams;
    await auction.submit(meta(seasonId, "A_BIDS"), 1, alpha!.seasonTeamId, [{ playerId: "p1", amount: 20 }], { finalize: true });
    expect((await auction.summary(actor, seasonId, 1)).teams[0]).not.toHaveProperty("bids");
    await expect(auction.lockAndResolve(meta(seasonId, "EARLY_LOCK"), 1, rules)).rejects.toThrow(/Every team/);
    await auction.submit(meta(seasonId, "B_ZERO"), 1, beta!.seasonTeamId, [], { finalize: true, confirmZero: true });
    const result = await auction.lockAndResolve(meta(seasonId, "LOCK_R1"), 1, rules); expect(result.status).toBe("RESOLVED");
    expect((await auction.summary(actor, seasonId, 1, true)).teams[0]!.bids?.[0]?.amount).toBe(20);
    await auction.publish(meta(seasonId, "PUBLISH_R1"), 1); await auction.publish(meta(seasonId, "PUBLISH_R1_RETRY"), 1);
    const round2 = await auction.open(meta(seasonId, "OPEN_R2"), 2); const r1 = await auction.summary(actor, seasonId, 1, true);
    for (const balance of round2.balances) expect(balance.startingBudget).toBe(150 + r1.balances.find(item => item.seasonTeamId === balance.seasonTeamId)!.remainingBudget);
    expect((await store.getSeason(actor, seasonId))!.state).toBe("R2_BIDDING");
  });

  it("does not persist a partial attempt when the pinned engine fails and reopen remasks", async () => {
    const { store, seasonId } = await fixture(); const failing = new AuctionService(store, { resolve() { throw new Error("engine failed"); } }); await failing.open(meta(seasonId, "OPEN"), 1); const summary = await failing.summary(actor, seasonId, 1);
    for (const team of summary.teams) await failing.submit(meta(seasonId, `ZERO_${team.teamId}`), 1, team.seasonTeamId, [], { finalize: true, confirmZero: true });
    await expect(failing.lockAndResolve(meta(seasonId, "FAIL"), 1, rules)).rejects.toThrow("engine failed"); expect((await failing.summary(actor, seasonId, 1)).attempts).toHaveLength(0);
    await failing.reopen(meta(seasonId, "REOPEN"), 1); const reopened = await failing.summary(actor, seasonId, 1, true); expect(reopened.revealed).toBe(false); expect(reopened.teams.every(team => !("bids" in team))).toBe(true);
  });

  it("records external tie metadata and reruns the exact frozen input with shrinking precedence", async () => {
    const { store, seasonId } = await fixture(); const seen: unknown[] = []; const service = new AuctionService(store, { resolve(input) { seen.push(input); const resolved = input.tiePrecedence.length > 0; return { status: resolved ? "RESOLVED" : "UNRESOLVED_TIE", awards: [], teamResults: input.teams.map(team => ({ teamId: team.teamId, spent: 0, remainingBudget: team.startingBudget, playerIds: team.startingPlayerIds })), unresolvedTies: resolved ? [] : [{ key: "p1:10:alpha|beta", playerId: "p1", amount: 10, teamIds: ["alpha", "beta"] }], eliminations: [], activeBidIds: [], trace: [{ step: resolved ? "tie-decided" : "tie" }] }; } });
    const openedRound = await service.open(meta(seasonId, "OPEN_TIE"), 1); for (const team of openedRound.teams) await service.submit(meta(seasonId, `TIE_ZERO_${team.teamId}`), 1, team.seasonTeamId, [], { finalize: true, confirmZero: true });
    expect((await service.lockAndResolve(meta(seasonId, "LOCK_TIE"), 1, rules)).status).toBe("UNRESOLVED_TIE");
    await expect(service.decideTieAndResolve(meta(seasonId, "BAD_TIE"), 1, { tieKey: "p1:10:alpha|beta", playerId: "p1", amount: 10, participantTeamIds: ["alpha", "beta"], preferredTeamId: "other", method: "coin", decidedAt: "2026-08-17T00:00:00.000Z" })).rejects.toThrow(/does not match/);
    expect((await service.decideTieAndResolve(meta(seasonId, "GOOD_TIE"), 1, { tieKey: "p1:10:alpha|beta", playerId: "p1", amount: 10, participantTeamIds: ["alpha", "beta"], preferredTeamId: "alpha", method: "coin flip", note: "heads", decidedAt: "2026-08-17T00:00:00.000Z" })).status).toBe("RESOLVED");
    expect({ ...(seen[0] as any), tiePrecedence: (seen[1] as any).tiePrecedence }).toEqual(seen[1]); expect((await service.summary(actor, seasonId, 1)).attempts).toHaveLength(2);
  });
});
