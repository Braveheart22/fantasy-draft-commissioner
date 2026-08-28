import { expect, test } from "@playwright/test";

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
