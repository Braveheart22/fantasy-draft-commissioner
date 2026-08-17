import test from "node:test";
import assert from "node:assert/strict";
import { resolveAuction } from "../src/index.js";
import { awards, b, input, p, t } from "./helpers.js";

const run = (teams, bids, opts = {}) => {
  const ids = new Set(bids.map((x) => x.playerId));
  const players = [...ids].map((id) => p(id, opts.positions?.[id] ?? "RB", opts.minimums?.[id] ?? 1));
  for (const rp of opts.rosterPlayers ?? []) players.push(rp);
  return resolveAuction(input(teams, players, bids, opts.tieDecisions));
};

test("Golden 1 — larger P2 defeats smaller P1", () => {
  assert.deepEqual(awards(run([t("A"), t("B")], [b("A", 1, "X", 100), b("B", 2, "X", 300)])), { X: "B:300" });
});

test("Golden 2 — larger P3 defeats smaller P1 after losing earlier opportunities", () => {
  const r = run([t("A"), t("B"), t("C"), t("D")], [b("A", 1, "X", 200), b("B", 1, "Y", 100), b("B", 2, "Z", 100), b("B", 3, "X", 250), b("C", 1, "Y", 110), b("D", 1, "Z", 110)]);
  assert.deepEqual(awards(r), { X: "B:250", Y: "C:110", Z: "D:110" });
});

test("Golden 3 — P1 consumes budget and releases higher P2", () => {
  assert.deepEqual(awards(run([t("A"), t("B")], [b("A", 1, "Y", 225), b("A", 2, "X", 300), b("B", 1, "X", 250)])), { X: "B:250", Y: "A:225" });
});

test("Golden 4 / authoritative Scenario B — losing P1 unlocks P2", () => {
  assert.deepEqual(awards(run([t("A"), t("B"), t("C")], [b("A", 1, "Y", 225), b("A", 2, "X", 300), b("B", 1, "X", 250), b("C", 1, "Y", 240)])), { X: "A:300", Y: "C:240" });
});

test("Golden 5 — losing P1 and P2 unlocks P3", () => {
  const r = run([t("A"), t("B"), t("C"), t("D")], [b("A", 1, "X", 200), b("A", 2, "Y", 200), b("A", 3, "Z", 300), b("B", 1, "X", 225), b("C", 1, "Y", 225), b("D", 1, "Z", 250)]);
  assert.deepEqual(awards(r), { X: "B:225", Y: "C:225", Z: "A:300" });
});

test("Golden 6 — owner leads three but preserves only P1; fallbacks win", () => {
  const r = run([t("A"), t("B"), t("C")], [b("A", 1, "X", 300), b("A", 2, "Y", 100), b("A", 3, "Z", 75), b("B", 1, "Y", 80), b("C", 1, "Z", 70)]);
  assert.deepEqual(awards(r), { X: "A:300", Y: "B:80", Z: "C:70" });
});

test("Golden 7 — owner preserves first two and releases third", () => {
  const r = run([t("A"), t("B")], [b("A", 1, "X", 150), b("A", 2, "Y", 100), b("A", 3, "Z", 125), b("B", 1, "Z", 90)]);
  assert.deepEqual(awards(r), { X: "A:150", Y: "A:100", Z: "B:90" });
  assert.equal(r.teamResults.find((x) => x.teamId === "A").remainingBudget, 100);
});

test("Golden 8/9 — exact budget succeeds; one dollar too expensive is released", () => {
  assert.deepEqual(awards(run([t("A")], [b("A", 1, "X", 200), b("A", 2, "Y", 150)])), { X: "A:200", Y: "A:150" });
  assert.deepEqual(awards(run([t("A")], [b("A", 1, "X", 200), b("A", 2, "Y", 151)])), { X: "A:200" });
});

test("Golden 10 — authoritative Scenario A", () => {
  const r = run([t("A"), t("B")], [b("A", 1, "X", 250), b("A", 2, "Y", 200), b("B", 1, "Y", 225), b("B", 2, "X", 300)]);
  assert.deepEqual(awards(r), { X: "A:250", Y: "B:225" });
});

test("Golden 11 — former Scenario 32", () => {
  const r = run([t("A"), t("B"), t("C")], [b("A", 1, "X", 250), b("A", 2, "Y", 200), b("B", 1, "Y", 225), b("B", 2, "X", 300), b("C", 1, "Y", 240)]);
  assert.deepEqual(awards(r), { X: "B:300", Y: "C:240" });
});

test("Golden 12 — approved dependency cycle convention", () => {
  const r = run([t("A", 70), t("B", 70)], [b("A", 1, "X", 30), b("A", 2, "Y", 50), b("B", 1, "Y", 40), b("B", 2, "X", 40)]);
  assert.deepEqual(awards(r), { X: "B:40", Y: "A:50" });
});

test("Golden 13 — three-level iterative fallback", () => {
  const r = run([t("A", 350), t("B", 350), t("C", 350)], [b("A", 1, "A1", 100), b("A", 2, "A2", 100), b("A", 3, "X", 300), b("B", 1, "B1", 100), b("B", 2, "X", 275), b("C", 1, "X", 250)]);
  assert.deepEqual(awards(r), { A1: "A:100", A2: "A:100", B1: "B:100", X: "C:250" });
  assert.equal(r.eliminations.filter((e) => e.playerId === "X").length, 2);
});

test("Golden 14/15 — losing higher opportunities preserves full lower-priority budget", () => {
  let r = run([t("A", 300), t("B"), t("C")], [b("A", 1, "X", 200), b("A", 2, "Y", 250), b("B", 1, "Y", 225), b("C", 1, "X", 210)]);
  assert.deepEqual(awards(r), { X: "C:210", Y: "A:250" });
  r = run([t("A", 300), t("B"), t("C")], [b("A", 1, "X", 175), b("A", 2, "Y", 175), b("A", 3, "Z", 300), b("B", 1, "X", 200), b("C", 1, "Y", 200)]);
  assert.deepEqual(awards(r), { X: "B:200", Y: "C:200", Z: "A:300" });
});

test("Golden 16 — complex three-owner cascade", () => {
  const r = run([t("A"), t("B"), t("C")], [b("A", 1, "X", 200), b("A", 2, "Y", 175), b("A", 3, "Z", 150), b("B", 1, "Y", 225), b("B", 2, "Z", 200), b("B", 3, "X", 250), b("C", 1, "Z", 240), b("C", 2, "X", 225), b("C", 3, "Y", 250)]);
  assert.deepEqual(awards(r), { X: "A:200", Y: "B:225", Z: "C:240" });
  assert.ok(r.trace.length >= 4);
});

test("Golden 17 — permanently roster-invalid high bidder falls back", () => {
  const roster = [p("Q1", "QB"), p("Q2", "QB")];
  const r = run([t("A", 350, ["Q1", "Q2"]), t("B")], [b("A", 1, "X", 300), b("B", 3, "X", 200)], { positions: { X: "QB" }, rosterPlayers: roster });
  assert.equal(awards(r).X, "B:200");
  assert.equal(r.eliminations.find((e) => e.teamId === "A").reason, "ROSTER_CAPACITY_EXCEEDED");
});

const flexRoster = [p("R1", "RB"), p("R2", "RB"), p("W1", "WR"), p("W2", "WR"), p("W3", "WR"), p("T1", "TE"), p("T2", "TE")];
test("Golden 18/19 — FLEX capacity follows owner priority", () => {
  const team = t("A", 350, flexRoster.map((x) => x.id));
  let r = run([team], [b("A", 1, "RX", 100), b("A", 2, "WX", 125)], { positions: { RX: "RB", WX: "WR" }, rosterPlayers: flexRoster });
  assert.deepEqual(awards(r), { RX: "A:100" });
  r = run([team], [b("A", 1, "WX", 125), b("A", 2, "RX", 100)], { positions: { RX: "RB", WX: "WR" }, rosterPlayers: flexRoster });
  assert.deepEqual(awards(r), { WX: "A:125" });
});

test("Golden 20/21 — FLEX release cascades through other owners", () => {
  const rosterA = flexRoster.map((x) => ({ ...x, id: `A${x.id}` }));
  const rosterB = flexRoster.map((x) => ({ ...x, id: `B${x.id}` }));
  let r = run([t("A", 350, rosterA.map((x) => x.id)), t("B")], [b("A", 1, "RX", 100), b("A", 2, "WX", 200), b("B", 3, "WX", 175)], { positions: { RX: "RB", WX: "WR" }, rosterPlayers: rosterA });
  assert.equal(awards(r).WX, "B:175");
  r = run([t("A", 350, rosterA.map((x) => x.id)), t("B", 350, rosterB.map((x) => x.id)), t("C")], [b("A", 1, "AR", 100), b("A", 2, "WX", 220), b("B", 1, "BT", 100), b("B", 2, "WX", 200), b("C", 1, "WX", 180)], { positions: { AR: "RB", BT: "TE", WX: "WR" }, rosterPlayers: [...rosterA, ...rosterB] });
  assert.equal(awards(r).WX, "C:180");
});

test("Golden 22/23 — permanent initial bid invalidation", () => {
  let r = run([t("A"), t("B")], [b("A", 1, "X", 90), b("B", 3, "X", 80)], { minimums: { X: 100 } });
  assert.deepEqual(r.eliminations.map((e) => e.reason), ["BELOW_MINIMUM", "BELOW_MINIMUM"]);
  assert.deepEqual(r.awards, []);
  r = run([t("A", 300), t("B")], [b("A", 3, "X", 350), b("B", 1, "X", 250)]);
  assert.equal(awards(r).X, "B:250");
  assert.equal(r.eliminations[0].reason, "BID_EXCEEDS_STARTING_BUDGET");
});

test("Golden 24 — priority never changes cross-owner dollar ranking", () => {
  assert.equal(awards(run([t("A"), t("B"), t("C")], [b("A", 1, "X", 200), b("B", 2, "X", 225), b("C", 3, "X", 250)])).X, "C:250");
});

test("Golden 25 — unresolved equal-dollar tie ignores priorities", () => {
  const r = run([t("A"), t("B")], [b("A", 1, "X", 200), b("B", 2, "X", 200)]);
  assert.equal(r.status, "UNRESOLVED_TIE");
  assert.deepEqual(r.unresolvedTies[0].teamIds, ["A", "B"]);
});

test("unresolved tie does not permanently prune either loser's lower priority", () => {
  const r = run([t("A"), t("B")], [b("A", 1, "X", 200), b("A", 2, "Y", 200), b("B", 1, "X", 200), b("B", 2, "Z", 200)]);
  assert.equal(r.status, "UNRESOLVED_TIE");
  assert.equal(r.eliminations.some((e) => ["Y", "Z"].includes(e.playerId)), false);
  assert.deepEqual(r.awards, []);
});

test("Golden 26 — apparent tie disappears after affordability pruning", () => {
  const r = run([t("A"), t("B")], [b("A", 1, "Y", 300), b("A", 2, "X", 200), b("B", 1, "X", 200)]);
  assert.equal(r.status, "RESOLVED");
  assert.deepEqual(awards(r), { X: "B:200", Y: "A:300" });
});

test("Golden 27 — external tie precedence deterministically affects another award", () => {
  const bids = [b("A", 1, "X", 200), b("A", 2, "Y", 200), b("B", 1, "X", 200), b("C", 1, "Y", 175)];
  let r = run([t("A"), t("B"), t("C")], bids, { tieDecisions: [{ playerId: "X", amount: 200, teamIds: ["A", "B"], preferredTeamId: "A" }] });
  assert.deepEqual(awards(r), { X: "A:200", Y: "C:175" });
  r = run([t("A"), t("B"), t("C")], bids, { tieDecisions: [{ playerId: "X", amount: 200, teamIds: ["B", "A"], preferredTeamId: "B" }] });
  assert.deepEqual(awards(r), { X: "B:200", Y: "A:200" });
});

test("Golden 28 — three-way tie prunes two unaffordable bidders without a draw", () => {
  const r = run([t("A"), t("B"), t("C")], [b("A", 1, "Y", 300), b("A", 2, "X", 200), b("B", 1, "Z", 300), b("B", 2, "X", 200), b("C", 1, "X", 200)]);
  assert.equal(r.status, "RESOLVED");
  assert.equal(awards(r).X, "C:200");
});

test("Golden 29 — invalidated preferred tied bidder leaves a new smaller tie", () => {
  const bids = [b("A", 1, "Y", 200), b("A", 2, "X", 200), b("B", 1, "X", 200), b("C", 1, "X", 200), b("D", 1, "Y", 250), b("D", 2, "Z", 200), b("E", 1, "Z", 250)];
  // Initially A leads only X. D leads Y and Z, releases Z; Z falls to E, so D keeps Y.
  // To force A's later P1 arrival, D must release Y due to a newly arriving higher priority.
  // This concrete chain is supplied by F -> D's P1 W fallback.
  bids.push(b("D", 1, "W", 200), b("F", 1, "W", 250), b("F", 2, "V", 200), b("G", 1, "V", 250));
  // Simpler direct approved semantic: A's P1 Y falls back after H cannot afford it.
  const scenario = [b("A", 1, "Y", 200), b("A", 2, "X", 200), b("B", 1, "X", 200), b("C", 1, "X", 200), b("H", 1, "Q", 300), b("H", 2, "Y", 250)];
  const r = run([t("A", 350), t("B"), t("C"), t("H", 350)], scenario, { tieDecisions: [{ playerId: "X", amount: 200, teamIds: ["A", "B", "C"], preferredTeamId: "A" }] });
  assert.equal(r.status, "UNRESOLVED_TIE");
  assert.deepEqual(r.unresolvedTies[0].teamIds, ["B", "C"]);
  assert.equal(awards(r).Y, "A:200");
});

test("recorded preferred bidder retains precedence when a nonpreferred participant drops out", () => {
  const r = run([t("A"), t("B"), t("C")], [b("A", 1, "X", 200), b("B", 1, "Y", 300), b("B", 2, "X", 200), b("C", 1, "X", 200)], { tieDecisions: [{ playerId: "X", amount: 200, teamIds: ["A", "B", "C"], preferredTeamId: "A" }] });
  assert.equal(r.status, "RESOLVED");
  assert.equal(awards(r).X, "A:200");
});

test("Golden 30 — circular three-owner preferences stabilize at dollar leaders", () => {
  const r = run([t("A", 100), t("B", 100), t("C", 100)], [b("A", 1, "X", 50), b("A", 2, "Y", 70), b("B", 1, "Y", 60), b("B", 2, "Z", 70), b("C", 1, "Z", 60), b("C", 2, "X", 70)]);
  assert.deepEqual(awards(r), { X: "C:70", Y: "A:70", Z: "B:70" });
});

test("Golden 31 — higher-priority opportunity arriving by fallback displaces P2", () => {
  const r = run([t("A", 100), t("B", 100), t("C", 100)], [b("A", 1, "X", 60), b("A", 2, "Y", 60), b("B", 1, "Z", 60), b("B", 2, "X", 70), b("C", 1, "W", 60), b("C", 2, "Z", 80)]);
  assert.deepEqual(awards(r), { W: "C:60", X: "A:60", Z: "B:60" });
  assert.ok(r.eliminations.some((e) => e.bidId === "A-2-Y"));
  assert.equal(r.status, "RESOLVED");
});
