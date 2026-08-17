import test from "node:test";
import assert from "node:assert/strict";
import { validateRosterCapacity, canAddPlayer } from "../src/index.js";

test("partial roster validator supports one shared RB/WR/TE FLEX", () => {
  for (const legal of [
    ["RB", "RB", "RB", "WR", "WR", "WR", "TE", "TE"],
    ["RB", "RB", "WR", "WR", "WR", "WR", "TE", "TE"],
    ["RB", "RB", "WR", "WR", "WR", "TE", "TE", "TE"],
  ]) assert.equal(validateRosterCapacity(legal).legal, true);
  for (const illegal of [
    ["RB", "RB", "RB", "WR", "WR", "WR", "WR", "TE", "TE"],
    ["RB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "TE"],
    ["QB", "QB", "QB"],
  ]) assert.equal(validateRosterCapacity(illegal).legal, false);
});

test("roster validator is pure and reports unknown positions", () => {
  const roster = ["QB"];
  assert.equal(canAddPlayer(roster, "QB").legal, true);
  assert.deepEqual(roster, ["QB"]);
  assert.equal(validateRosterCapacity(["PUNTER"]).reason, "UNKNOWN_POSITION");
});
