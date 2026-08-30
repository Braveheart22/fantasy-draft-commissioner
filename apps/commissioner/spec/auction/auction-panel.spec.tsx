import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuctionPanel } from "../../src/ui/stages/auction/auction-panel.jsx";

describe("commissioner auction panel", () => {
  it("renders private team entry, three ordered name-driven rows, and explicit draft/final controls", () => {
    const html = renderToStaticMarkup(<AuctionPanel seasonId="s" roundNumber={1} request={async () => ({})} onChanged={() => {}} initialSummary={{
      rowVersion: 9, roundId: "r", roundNumber: 1, status: "BIDDING", revealed: false,
      teams: [{ seasonTeamId: "st-a", teamId: "a", displayName: "Alpha", status: "DRAFT", bidCount: 1 }, { seasonTeamId: "st-b", teamId: "b", displayName: "Beta", status: "FINAL", bidCount: 0 }],
      attempts: [], balances: [{ seasonTeamId: "st-a", startingBudget: 350, spent: 0, remainingBudget: 350 }, { seasonTeamId: "st-b", startingBudget: 350, spent: 0, remainingBudget: 350 }],
    }} initialSubmission={{ seasonTeamId: "st-a", status: "DRAFT", bidCount: 1, zeroConfirmed: false, bids: [{ bidId: "b1", priority: 1, playerId: "p1", playerName: "Eddie Gallagher", position: "K", minimumBid: 7, amount: 12 }] }} />);
    expect(html).toContain("Alpha bid entry");
    expect(html).toContain("Eddie Gallagher");
    expect(html).toContain("$7 minimum");
    expect(html).toContain("Save draft");
    expect(html).toContain("Finalize saved draft");
    expect(html).toContain("Finalize zero bids");
    expect(html).toContain("Priority 3 player");
    expect(html).not.toContain("Player ID");
  });
});
