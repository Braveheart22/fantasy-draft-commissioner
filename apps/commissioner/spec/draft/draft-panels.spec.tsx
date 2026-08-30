import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DraftPanel } from "../../src/ui/stages/draft/draft-panel.jsx";

const summary = {
  status: "IN_PROGRESS", ties: [], nextOverallPick: 2, currentRound: 1, filledRosterSlots: 1, totalRosterSlots: 28,
  currentSeasonTeamId: "beta",
  order: [{ orderPosition: 1, seasonTeamId: "alpha", displayName: "Alpha", remainingBalance: 120 }, { orderPosition: 2, seasonTeamId: "beta", displayName: "Beta", remainingBalance: 110 }],
  teams: [
    { seasonTeamId: "alpha", displayName: "Alpha", roster: [{ playerId: "p0", playerName: "Keeper", position: "QB", acquisitionSource: "KEEPER" }], positionCounts: { QB: 1 }, openSlots: 13, legalNextPositions: ["RB", "WR"] },
    { seasonTeamId: "beta", displayName: "Beta", roster: [], positionCounts: {}, openSlots: 14, legalNextPositions: ["QB", "RB", "WR", "TE", "K", "DST"] },
  ],
  history: [{ overallPick: 1, roundNumber: 1, seasonTeamId: "alpha", displayName: "Alpha", playerId: "p0", playerName: "Keeper", position: "QB" }],
};

describe("DraftPanel", () => {
  it("renders clock, rosters, needs, history, and the persistent commit action", () => {
    const html = renderToStaticMarkup(<DraftPanel seasonId="season" request={async () => ({})} initialSummary={summary} />);
    expect(html).toContain("Beta is on the clock");
    expect(html).toContain("Open slots: 14");
    expect(html).toContain("Pick 1");
    expect(html).toContain("Keeper");
    expect(html).toContain("Alpha roster");
    expect(html).toContain("Commit legal pick");
    expect(html).not.toContain("Player ID");
  });
});
