import { expect, test } from "@playwright/test";

test("Setup offers an explicit Sleeper preparation source without making it a startup dependency", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create two-team season" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.route("**/api/catalog/*/preparations/sleeper", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "synthetic-sleeper", sourceNamespace: "sleeper", format: "json", sourceHash: "a".repeat(64), normalizedHash: "b".repeat(64), expectedSeasonVersion: 1, state: "STAGED", rowCount: 2, unresolvedCount: 0, rows: [] }) }));
  await page.getByRole("button", { name: "Fetch Sleeper catalog" }).click();
  await expect(page.getByText("Staged 2 Sleeper players; 0 need review.")).toBeVisible();
});

test("canonical catalog review survives the normal setup flow through keeper lock", async ({ page }) => {
  await page.goto("/");
  const run = async name => {
    await page.getByRole("button", { name }).click();
    await expect(page.getByText("Saving…")).toBeVisible();
    await expect(page.getByText("Saved")).toBeVisible();
  };
  await run("Create two-team season");
  await run("Add teams");
  await run("Add Eddie Gallagher");
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
  await run("Set $1 floors");
  await run("Keep Justin Jefferson for Beta");
  await run("Lock keepers");
  await expect(page.getByText("Alpha: $350")).toBeVisible();
  await expect(page.getByText("Beta: $300")).toBeVisible();
});
