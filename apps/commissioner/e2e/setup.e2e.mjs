import { expect, test } from "@playwright/test";
import { createDemoSeason, loadSeason } from "./demo-profile.mjs";

test("Setup offers an explicit Sleeper preparation source without making it a startup dependency", async ({ page, request }) => {
  const { seasonId } = await createDemoSeason(request, "EMPTY");
  await loadSeason(page, seasonId);
  await page.route("**/api/catalog/*/preparations/sleeper", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "synthetic-sleeper", sourceNamespace: "sleeper", format: "json", sourceHash: "a".repeat(64), normalizedHash: "b".repeat(64), expectedSeasonVersion: 1, state: "STAGED", rowCount: 2, unresolvedCount: 0, rows: [] }) }));
  await page.getByRole("button", { name: "Fetch Sleeper catalog" }).click();
  await expect(page.getByText("Staged 2 Sleeper players; 0 need review.")).toBeVisible();
});

test("canonical catalog review survives the normal setup flow through keeper lock", async ({ page, request }) => {
  const { seasonId } = await createDemoSeason(request, "SETUP");
  await loadSeason(page, seasonId);
  const run = async name => {
    await page.getByRole("button", { name }).first().click();
    await expect(page.getByText("Saving…")).toBeVisible();
    await expect(page.getByText("Saved")).toBeVisible();
  };
  await page.getByLabel("Catalog file").setInputFiles({
    name: "canonical.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify([
      { externalId: "provider-eddie", name: "Eddie Gallagher", position: "K" },
      { externalId: "jj-18", name: "Justin Jefferson", position: "WR", nflTeam: "MIN" },
    ])),
  });
  await page.getByRole("button", { name: "Stage catalog preview" }).click();
  await expect(page.getByText(/2 players; 1 need review/)).toBeVisible();
  await expect(page.getByText(/matches protected custom player/)).toBeVisible();
  await page.getByRole("button", { name: "Keep separate player" }).click();
  await expect(page.getByText("0 review items remain.")).toBeVisible();
  await page.getByRole("button", { name: "Approve catalog" }).click();
  await expect(page.getByText("Approved 2 catalog players for offline use.")).toBeVisible();
  await page.getByLabel("Default positional floor").first().fill("1");
  await run("Save positional floors");
  await page.getByText("Manage keeper eligibility").click();
  await page.getByLabel("Eligibility player search").fill("Justin Jefferson");
  await page.getByLabel("Eligibility player search").press("Enter");
  await page.getByLabel("Eligibility player", { exact: true }).getByRole("button", { name: /^Justin Jefferson ·/ }).click();
  await page.getByRole("button", { name: "Add keeper eligibility" }).click();
  await expect(page.getByText("Justin Jefferson (WR) · NFL catalog", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Beta", exact: true }).click();
  await page.getByLabel("Keeper player search").fill("Justin Jefferson");
  await page.getByLabel("Keeper player search").press("Enter");
  await page.getByLabel("Beta keeper", { exact: true }).getByRole("button", { name: /^Justin Jefferson ·/ }).click();
  await page.getByRole("button", { name: "Save keeper for Beta" }).click();
  await expect(page.getByText("$50 keeper cost; $300 Round 1 budget.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Alpha: No keeper · $350 budget" })).toBeVisible();
  const loadedSeasonId = await page.getByLabel("Existing season ID").inputValue();
  await page.getByRole("button", { name: "Load season" }).click();
  await expect(page.getByLabel("Existing season ID")).toHaveValue(loadedSeasonId);
  await page.getByRole("button", { name: "Beta", exact: true }).click();
  await expect(page.getByText("Justin Jefferson · WR", { exact: false }).first()).toBeVisible();
  await page.getByLabel("I reviewed every team and confirm keeper lock").check();
  await page.getByRole("button", { name: "Lock reviewed keepers" }).click();
  await page.getByRole("button", { name: "Open round 1", exact: true }).click();
  await expect(page.getByText("$350 starting budget")).toBeVisible();
  await page.getByRole("button", { name: "Beta · DRAFT · 0 bid(s)", exact: true }).click();
  await expect(page.getByText("$300 starting budget")).toBeVisible();
});

test("commissioner stages, resolves, and approves a durable price list", async ({ page, request }) => {
  const { seasonId } = await createDemoSeason(request, "SETUP");
  await loadSeason(page, seasonId);
  await expect(page.getByText("Eddie Gallagher (K) — missing")).toBeVisible();
  await page.getByLabel("Price-list file").setInputFiles({
    name: "prices.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify([{ name: "Eddie Gallagher", position: "K", minimumBid: 7 }])),
  });
  await page.getByRole("button", { name: "Stage price-list preview" }).click();
  await expect(page.getByText("Staged 1 prices; 1 need review.")).toBeVisible();
  await page.getByLabel("Resolve price player").selectOption({ label: "Eddie Gallagher (K)" });
  await expect(page.getByText("All rows are matched and ready for approval.")).toBeVisible();
  await page.getByRole("button", { name: "Approve price list" }).click();
  await expect(page.getByText("Price list approved for offline draft-night use.")).toBeVisible();
  await expect(page.getByText("Eddie Gallagher (K) — $7 · commissioner-price-list")).toBeVisible();
});
