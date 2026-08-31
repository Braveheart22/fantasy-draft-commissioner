import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { guardedStageRoute, installStageMutationGuard } from "../../src/ui/shared/stage-mutation-guard.jsx";
import { boundedFinderPage } from "../../src/ui/shared/player-finder.jsx";
import { DraftPanel } from "../../src/ui/stages/draft/draft-panel.jsx";
import { DraftOrderPanel } from "../../src/ui/stages/draft-order/draft-order-panel.jsx";

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
  it("retains mounted recovery state for link and hash navigation, but permits canonical completion", () => {
    const target = new EventTarget();
    let blocked = true;
    const dispose = installStageMutationGuard(target, "DRAFT", () => blocked);
    expect(target.dispatchEvent(new CustomEvent("stage-navigation-request", { cancelable: true, detail: { stage: "SETUP" } }))).toBe(false);
    const restore = vi.fn();
    expect(guardedStageRoute(target, "KEEPERS", "DRAFT", "DRAFT", restore)).toBe("DRAFT");
    expect(restore).toHaveBeenCalledWith("DRAFT");
    expect(guardedStageRoute(target, "RESULTS", "DRAFT", "RESULTS", restore)).toBe("RESULTS");
    blocked = false;
    expect(guardedStageRoute(target, "KEEPERS", "DRAFT", "DRAFT", restore)).toBe("KEEPERS");
    dispose();
    blocked = true;
    expect(target.dispatchEvent(new CustomEvent("stage-navigation-request", { cancelable: true, detail: { stage: "SETUP" } }))).toBe(true);
  });
  it("bounds a finder page after its final available player is drafted", () => {
    expect(boundedFinderPage(2, 1)).toBe(1);
    expect(boundedFinderPage(2, 0)).toBe(1);
    expect(boundedFinderPage(2, 3)).toBe(2);
  });
  it("renders clock, rosters, needs, history, and the persistent commit action", () => {
    const html = renderToStaticMarkup(<DraftPanel seasonId="season" request={async () => ({})} initialSummary={summary} />);
    expect(html).toContain("Beta is on the clock");
    expect(html).toContain("Open slots: 14");
    expect(html).toContain("Pick 1");
    expect(html).toContain("Keeper");
    expect(html).toContain("Alpha roster");
    expect(html).toContain("Commit legal pick");
    expect(html).not.toContain("Player ID");
    expect(html).toContain("Fixed draft order");
    expect(html).toContain("QB (1)");
  });
  it("asks the commissioner to record named external precedence instead of inventing it", () => {
    const html = renderToStaticMarkup(<DraftOrderPanel seasonId="season" request={async () => ({})} initialSummary={{...summary, ties:[{balance:100,seasonTeamIds:["alpha","beta"]}]}} />);
    expect(html).toContain("Precedence 1 at $100");
    expect(html).toContain("Tie decision method at $100");
    expect(html).toContain("Choose team");
  });
});
