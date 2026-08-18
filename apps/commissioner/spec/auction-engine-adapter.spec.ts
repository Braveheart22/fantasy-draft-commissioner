import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// Phase 1 intentionally remains JavaScript and has no declaration file.
// @ts-expect-error Direct import is required for the adapter equality characterization.
import { resolveAuction } from "../../../src/index.js";
import type { CommissionerAuctionInput } from "../src/application/ports/auction-engine.js";
import {
  AuctionMappingError,
  resolveAuctionThroughAdapter,
  toEngineInput,
} from "../src/integrations/auction-engine-adapter.js";

const base = (): CommissionerAuctionInput => ({
  teams: [
    { teamId: "A", startingBudget: 350, startingPlayerIds: [] },
    { teamId: "B", startingBudget: 350, startingPlayerIds: [] },
  ],
  players: [{ playerId: "X", position: "RB", minimumBid: 1, available: true }],
  bids: [
    { bidId: "A-1-X", teamId: "A", priority: 1 as const, playerId: "X", amount: 200 },
    { bidId: "B-1-X", teamId: "B", priority: 1 as const, playerId: "X", amount: 200 },
  ],
  rosterRules: {
    positionLimits: { QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 },
    flexEligiblePositions: ["RB", "WR", "TE"],
    flexCapacity: 1,
  },
  tiePrecedence: [],
});

describe("auction engine adapter", () => {
  it("returns exactly the direct Phase 1 result", () => {
    const input = base();
    expect(resolveAuctionThroughAdapter(input)).toEqual(resolveAuction(toEngineInput(input)));
  });

  it.each([
    ["position", (value: ReturnType<typeof base>) => { value.players[0]!.position = "PUNTER"; }],
    ["minimumBid", (value: ReturnType<typeof base>) => { value.players[0]!.minimumBid = 0; }],
    ["startingBudget", (value: ReturnType<typeof base>) => { value.teams[0]!.startingBudget = -1; }],
  ])("rejects invalid %s at the mapping boundary", (_label, mutate) => {
    const input = base();
    mutate(input);
    expect(() => toEngineInput(input)).toThrow(AuctionMappingError);
  });

  it("round-trips an unresolved tie without changing trace order", () => {
    const result = resolveAuctionThroughAdapter(base());
    expect(result.status).toBe("UNRESOLVED_TIE");
    expect(result.unresolvedTies).toEqual([{ key: '["X",200,["A","B"]]', playerId: "X", amount: 200, teamIds: ["A", "B"] }]);
  });

  it("maps supplied precedence and produces the stable direct trace/hash", () => {
    const input = base();
    input.tiePrecedence.push({ playerId: "X", amount: 200, participantTeamIds: ["B", "A"], preferredTeamId: "B" });
    const mapped = toEngineInput(input);
    const direct = resolveAuction(mapped);
    const adapted = resolveAuctionThroughAdapter(input);
    expect(adapted).toEqual(direct);
    expect(adapted.status).toBe("RESOLVED");
    expect(adapted.awards[0]?.teamId).toBe("B");
    expect(createHash("sha256").update(JSON.stringify(adapted.trace)).digest("hex"))
      .toBe(createHash("sha256").update(JSON.stringify(direct.trace)).digest("hex"));
  });
});
