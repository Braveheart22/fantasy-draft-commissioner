import test from "node:test";
import assert from "node:assert/strict";
import { AuctionInputError, resolveAuction, validateRosterCapacity } from "../src/index.js";

function rng(seed) {
  let state = seed >>> 0;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
}

function generated(seed) {
  const random = rng(seed);
  const positions = ["QB", "RB", "WR", "TE", "K", "DST"];
  const teams = Array.from({ length: 2 + Math.floor(random() * 5) }, (_, i) => ({ id: `T${i}`, budget: 50 + Math.floor(random() * 301), roster: [] }));
  const players = Array.from({ length: 2 + Math.floor(random() * 7) }, (_, i) => ({ id: `P${i}`, position: positions[Math.floor(random() * positions.length)], minimumBid: 1 + Math.floor(random() * 25) }));
  const bids = [];
  for (const [ti, team] of teams.entries()) {
    const shuffled = [...players].sort(() => random() - 0.5).slice(0, Math.floor(random() * 4));
    shuffled.forEach((player, index) => bids.push({
      id: `${team.id}-B${index}`,
      teamId: team.id,
      playerId: player.id,
      priority: index + 1,
      // The team suffix makes equal-dollar bids impossible in this generator.
      amount: 1 + Math.floor(random() * 35) * 10 + ti,
    }));
  }
  return { teams, players, bids, tieDecisions: [] };
}

const shuffled = (xs) => [...xs].reverse();

test("property invariants across 300 generated auctions", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const auction = generated(seed);
    const frozen = structuredClone(auction);
    const result = resolveAuction(auction);
    assert.deepEqual(auction, frozen, `input purity seed ${seed}`);

    const awardPlayers = result.awards.map((a) => a.playerId);
    assert.equal(new Set(awardPlayers).size, awardPlayers.length, `unique awards seed ${seed}`);
    const bidById = new Map(auction.bids.map((bid) => [bid.id, bid]));
    const active = new Set(result.activeBidIds);
    for (const award of result.awards) {
      const bid = bidById.get(award.bidId);
      assert.ok(bid, `award traces to bid seed ${seed}`);
      assert.equal(award.amount, bid.amount, `winning dollars seed ${seed}`);
      const activeForPlayer = auction.bids.filter((x) => x.playerId === award.playerId && active.has(x.id));
      assert.equal(award.amount, Math.max(...activeForPlayer.map((x) => x.amount)), `active dollar precedence seed ${seed}`);
    }
    for (const teamResult of result.teamResults) {
      const team = auction.teams.find((x) => x.id === teamResult.teamId);
      assert.ok(teamResult.spent <= team.budget && teamResult.remainingBudget >= 0, `budget seed ${seed}`);
      const wonPositions = result.awards.filter((x) => x.teamId === team.id).map((x) => auction.players.find((p) => p.id === x.playerId).position);
      assert.equal(validateRosterCapacity(wonPositions).legal, true, `roster seed ${seed}`);
    }

    const eliminatedSoFar = new Set();
    for (const step of result.trace.filter((x) => x.type === "PROVISIONAL_PASS")) {
      for (const id of step.provisionalBidIds) assert.equal(eliminatedSoFar.has(id), false, `no reactivation seed ${seed}`);
      for (const id of step.eliminatedBidIds) {
        assert.equal(eliminatedSoFar.has(id), false, `one-way elimination seed ${seed}`);
        eliminatedSoFar.add(id);
      }
    }

    const reordered = {
      teams: shuffled(auction.teams),
      players: shuffled(auction.players),
      bids: shuffled(auction.bids),
      tieDecisions: [],
    };
    assert.deepEqual(resolveAuction(reordered), result, `order independence seed ${seed}`);
    assert.deepEqual(resolveAuction(structuredClone(auction)), result, `determinism seed ${seed}`);
  }
});

test("structural bid and domain validation rejects malformed input", () => {
  const base = { teams: [{ id: "A", budget: 100, roster: [] }], players: [{ id: "X", position: "QB", minimumBid: 1 }], bids: [] };
  const invalids = [
    null,
    {},
    { ...base, teams: [...base.teams, base.teams[0]] },
    { ...base, players: [{ id: "X", position: "NOPE", minimumBid: 1 }] },
    { ...base, players: [{ id: "X", position: "QB", minimumBid: 0 }] },
    { ...base, bids: [{ id: "b", teamId: "A", playerId: "X", priority: 4, amount: 1 }] },
    { ...base, bids: [{ id: "b", teamId: "A", playerId: "X", priority: 1, amount: 1.5 }] },
    { ...base, bids: [{ id: "b1", teamId: "A", playerId: "X", priority: 1, amount: 1 }, { id: "b2", teamId: "A", playerId: "X", priority: 2, amount: 2 }] },
    { ...base, players: [{ id: "X", position: "toString", minimumBid: 1 }] },
    { ...base, rosterRules: { limits: { QB: -1 }, flexEligible: [], flexCapacity: 0 } },
    { ...base, tieDecisions: [{ playerId: "X", amount: 1, teamIds: ["A", "GHOST"], preferredTeamId: "A" }] },
    { ...base, teams: [null] },
    { ...base, teams: [{ id: "A", budget: 100, roster: 1 }] },
    { ...base, players: [null] },
    { ...base, bids: [null] },
    { ...base, tieDecisions: [null] },
  ];
  for (const value of invalids) assert.throws(() => resolveAuction(value), AuctionInputError);
});

test("0, 1, 2, or 3 bids per owner are valid", () => {
  for (let count = 0; count <= 3; count += 1) {
    const players = Array.from({ length: count }, (_, i) => ({ id: `P${i}`, position: "RB", minimumBid: 1 }));
    const bids = players.map((player, i) => ({ id: `B${i}`, teamId: "A", playerId: player.id, priority: i + 1, amount: 1 }));
    assert.doesNotThrow(() => resolveAuction({ teams: [{ id: "A", budget: 10, roster: [] }], players, bids }));
  }
});

test("tie-decision replay is deterministic and independent of collection ordering", () => {
  const auction = {
    teams: [{ id: "A", budget: 350, roster: [] }, { id: "B", budget: 350, roster: [] }, { id: "C", budget: 350, roster: [] }],
    players: [{ id: "X", position: "QB", minimumBid: 1 }, { id: "Y", position: "RB", minimumBid: 1 }],
    bids: [
      { id: "a1", teamId: "A", playerId: "X", priority: 1, amount: 200 },
      { id: "b1", teamId: "B", playerId: "X", priority: 1, amount: 200 },
      { id: "b2", teamId: "B", playerId: "Y", priority: 2, amount: 150 },
      { id: "c1", teamId: "C", playerId: "Y", priority: 1, amount: 140 },
    ],
    tieDecisions: [{ playerId: "X", amount: 200, teamIds: ["B", "A"], preferredTeamId: "B" }],
  };
  const expected = resolveAuction(auction);
  const reordered = { ...auction, teams: [...auction.teams].reverse(), players: [...auction.players].reverse(), bids: [...auction.bids].reverse(), tieDecisions: [{ ...auction.tieDecisions[0], teamIds: ["A", "B"] }] };
  assert.deepEqual(resolveAuction(reordered), expected);
  assert.deepEqual(resolveAuction(structuredClone(auction)), expected);
});
