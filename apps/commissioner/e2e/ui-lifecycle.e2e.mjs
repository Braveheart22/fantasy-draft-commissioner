import { expect, test } from "@playwright/test";
import { act, load, recordExternalTie, seedLockedSeason, selectPlayer, transport, zeroBidRound } from "../e2e-support/lifecycle.mjs";

test("commissioner UI completes both rounds, order, fixed draft, recovery, and export", async ({ page, request }) => {
  const seasonId = `ui-full-${Date.now()}`;
  await seedLockedSeason(request, seasonId);
  await load(page, seasonId);
  await zeroBidRound(page, 1);
  await expect(page.getByRole("heading", { name: "Auction round 2" })).toBeVisible();
  await zeroBidRound(page, 2);
  await act(page,page.getByRole("button", { name: "Calculate order from Round 2 balances" }));
  await recordExternalTie(page);
  await act(page,page.getByRole("button", { name: "Finalize permanent order" }));

  const setup = await (await request.get(`/api/setup/${seasonId}`)).json();
  const draft = await (await request.get(`/api/draft/${seasonId}`)).json();
  const teamIndex = new Map(setup.teams.map((team, index) => [team.seasonTeamId, index]));
  for (let round = 0; round < 14; round++) {
    for (const entry of draft.order) {
      await selectPlayer(page,"Available player",`Player ${teamIndex.get(entry.seasonTeamId) * 14 + round}`);
      await act(page,page.getByRole("button", { name: "Commit legal pick" }));
    }
  }
  await page.getByRole("button", { name: "Create CSV & JSON" }).click();
  await expect(page.getByText("Export complete")).toBeVisible();
  await expect(page.getByText(/final-rosters\.json/)).toBeVisible();
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("button", { name: "Show recovery summary" }).click();
  await expect(page.getByText("Database integrity: ok; schema 11.")).toBeVisible();
});

test("commissioner UI records an auction tie and confirms an audited correction", async ({ page, request }) => {
  const seasonId = `ui-ops-${Date.now()}`;
  await seedLockedSeason(request, seasonId, 1);
  await load(page, seasonId);
  await act(page,page.getByRole("button", { name: "Open round 1" }));
  await selectPlayer(page,"Priority 1 player","Player 0");
  await page.getByLabel("Priority 1 amount").fill("10");
  await act(page,page.getByRole("button", { name: "Save draft", exact: true }));
  await act(page,page.getByRole("button", { name: "Finalize saved draft", exact: true }));
  await page.getByRole("button", { name: "Beta · DRAFT · 0 bid(s)", exact: true }).click();
  await selectPlayer(page,"Priority 1 player","Player 0");
  await page.getByLabel("Priority 1 amount").fill("10");
  await act(page,page.getByRole("button", { name: "Save draft", exact: true }));
  await act(page,page.getByRole("button", { name: "Finalize saved draft", exact: true }));
  await act(page,page.getByRole("button", { name: "Lock, resolve & reveal round 1" }));
  await act(page,page.getByRole("button", { name: /Record external tie winner/ }));
  await act(page,page.getByRole("button", { name: "Publish round 1" }));

  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
  await page.getByLabel("Correction target").selectOption({ label: "Auction round 1 · PUBLISHED" });
  await page.getByRole("button", { name: "Preview correction impact" }).click();
  await expect(page.getByText(/correction affects/i)).toBeVisible();
  await page.getByLabel("Correction reason").fill("Correct the recorded external result");
  await page.getByLabel("Typed correction confirmation").fill("CONFIRM ROLLBACK");
  await page.getByRole("button", { name: "Confirm audited rollback" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
  await expect(page.getByRole("heading", { name: "Auction round 1" })).toBeVisible();
});

test("player finder keeps filters and keyboard selection bounded on a large catalog", async ({ page, request }) => {
  const seasonId = `ui-finder-${Date.now()}`;
  await seedLockedSeason(request, seasonId, 1);
  const searchRequests = [];
  await page.route(`**/api/catalog/${seasonId}/search?*`, async route => {
    const url = new URL(route.request().url());
    searchRequests.push(url.search);
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    const items = Array.from({ length: 25 }, (_, index) => ({
      id: `large-${pageNumber}-${index}`,
      name: `Large Player ${pageNumber}-${index}`,
      position: "WR",
      nflTeam: "MIN",
      sourceType: "NFL",
      providerStatus: "ACTIVE",
      providerActive: true,
      leagueSelectable: true,
      keeperEligible: false,
      normalizedSearchText: `large player ${pageNumber} ${index}`,
      aliases: [],
      owned: false,
      available: true,
      reason: "AVAILABLE",
      availabilityReason: "AVAILABLE",
      stageAllowed: true,
      minimumBid: 1,
      priceSource: "FLOOR",
      priceSourceLabel: "WR floor",
    }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ page: pageNumber, pageSize: 25, total: 2500, totalPages: 100, items }) });
  });
  await load(page, seasonId);
  await act(page,page.getByRole("button", { name: "Open round 1" }));

  const bidFinder = page.getByLabel("Priority 1 player", { exact: true });
  await bidFinder.getByLabel("Priority 1 player search").fill("large");
  await bidFinder.getByLabel("Position").selectOption("WR");
  await bidFinder.getByLabel("NFL team").fill("MIN");
  await bidFinder.getByLabel("Source").selectOption("NFL");
  await page.getByLabel("Priority 1 player search").press("Enter");
  await expect(bidFinder.getByText("2500 players found.")).toBeVisible();
  await expect(bidFinder.locator("li button")).toHaveCount(25);
  const firstResult = bidFinder.getByRole("button", { name: /^Large Player 1-0 ·/ });
  await firstResult.focus();
  await firstResult.press("Enter");
  await expect(firstResult).toHaveAttribute("aria-pressed", "true");
  await bidFinder.getByRole("button", { name: "Next players" }).click();
  await expect(bidFinder.getByText("Page 2 of 100")).toBeVisible();
  await expect(page.getByLabel("Priority 1 player search")).toHaveValue("large");
  await expect(bidFinder.getByLabel("Position")).toHaveValue("WR");
  await expect(bidFinder.getByLabel("NFL team")).toHaveValue("MIN");
  await expect(bidFinder.getByLabel("Source")).toHaveValue("NFL");
  expect(searchRequests.at(-1)).toContain("search=large");
  expect(searchRequests.at(-1)).toContain("nflTeam=MIN");
  expect(searchRequests.at(-1)).toContain("sourceType=NFL");
});

test("loading another season replaces active staged UI state", async ({ page, request }) => {
  const currentSeasonId = `ui-current-${Date.now()}`;
  const advancedSeasonId = `ui-advanced-${Date.now()}`;
  const current = await seedLockedSeason(request, currentSeasonId, 1);
  await current("POST", `/api/auction/${currentSeasonId}/1/open`);
  await seedLockedSeason(request, advancedSeasonId, 1);

  await load(page, advancedSeasonId);
  await zeroBidRound(page, 1);
  await zeroBidRound(page, 2);
  await act(page, page.getByRole("button", { name: "Calculate order from Round 2 balances" }));
  await recordExternalTie(page);
  await act(page, page.getByRole("button", { name: "Finalize permanent order" }));
  await expect(page.getByText("Round 1 · Overall pick 1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Priority 1 player search")).toHaveCount(0);
  await selectPlayer(page,"Available player","Player 0");

  await page.getByLabel("Existing season ID").fill(currentSeasonId);
  await page.getByRole("button", { name: "Load season" }).click();

  await expect(page.getByRole("heading", { name: "Auction round 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Auction round 2" })).toHaveCount(0);
  await expect(page.getByLabel("Priority 1 player search")).toHaveValue("");
  await expect(page.getByLabel("Available player search")).toHaveCount(0);
  await expect(page.getByText("Round 1 · Overall pick 1", { exact: true })).toHaveCount(0);
});

test("direct future navigation redirects and completed stages expose no normal mutations", async ({ page, request }) => {
  const seasonId = `ui-navigation-${Date.now()}`;
  await seedLockedSeason(request, seasonId, 1);
  await load(page, seasonId);

  await page.evaluate(() => { location.hash = "stage/DRAFT"; });
  await expect(page.getByRole("note")).toContainText("Draft is not available until Auction 1 is complete");
  await expect(page.locator('[data-stage="AUCTION_1"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Open round 1" })).toBeEnabled();

  await page.getByRole("link", { name: "Setup" }).click();
  await expect(page.locator('[data-stage="SETUP"][data-mode="READ_ONLY"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Save teams" })).toBeDisabled();
  const floorButtons = page.getByRole("button", { name: "Save positional floors" });
  await expect(floorButtons).toHaveCount(2);
  await expect(floorButtons.nth(0)).toBeDisabled();
  await expect(floorButtons.nth(1)).toBeDisabled();
  await page.getByRole("button", { name: "Preview a correction in Operations" }).click();
  await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open round 1" })).toHaveCount(0);
});
