import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KeepersPanel } from "../../src/ui/stages/keepers/keepers-panel.jsx";

describe("commissioner keepers panel", () => {
  it("renders team-centric selection, eligibility, budgets, preflight, and explicit lock review without raw IDs", () => {
    const html = renderToStaticMarkup(<KeepersPanel seasonId="s" request={async () => ({})} onChanged={() => {}} initialSummary={{
      season: { id: "s", leagueId: "l", year: 2026, name: "Season", state: "SETUP", teamCount: 2, rowVersion: 7 },
      locked: false,
      keeperCost: 50,
      eligiblePlayers: [{ id: "eddie", name: "Eddie Gallagher", position: "K", sourceType: "LEAGUE_CUSTOM", providerActive: true, leagueSelectable: true, keeperEligible: true, available: true, availabilityReason: "AVAILABLE", minimumBid: 7, priceSourceLabel: "Commissioner override", valid: true }],
      teams: [
        { id: "a", seasonTeamId: "st-a", displayName: "Alpha", seedOrder: 1, keeperCost: 50, startingBudget: 300, selectedPlayer: { id: "eddie", name: "Eddie Gallagher", position: "K", sourceType: "LEAGUE_CUSTOM", providerActive: true, leagueSelectable: true, keeperEligible: true, available: true, availabilityReason: "AVAILABLE", minimumBid: 7, priceSourceLabel: "Commissioner override", valid: true } },
        { id: "b", seasonTeamId: "st-b", displayName: "Beta", seedOrder: 2, keeperCost: 0, startingBudget: 350 },
      ],
      preflight: { expectedTeamCount: 2, configuredTeamCount: 2, missingTeamCount: 0, invalidSelectionCount: 0, missingPriceCount: 0, unresolvedPriceReviewCount: 0, canLock: true },
    }} />);
    expect(html).toContain("Alpha");
    expect(html).toContain("Eddie Gallagher");
    expect(html).toContain("League custom");
    expect(html).toContain("$50 keeper cost");
    expect(html).toContain("$300 Round 1 budget");
    expect(html).toContain("Final lock review");
    expect(html).toContain("I reviewed every team");
    expect(html).not.toContain("Player ID");
  });
});
