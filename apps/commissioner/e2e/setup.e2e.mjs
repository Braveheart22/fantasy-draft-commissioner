import { expect, test } from "@playwright/test";

test("empty database reaches keeper lock and displays Round 1 budgets", async ({ page }) => {
  await page.goto("/");
  const run = async name => {
    await page.getByRole("button", { name }).click();
    await expect(page.getByText("Saving…")).toBeVisible();
    await expect(page.getByText("Saved")).toBeVisible();
  };
  await run("Create two-team season");
  await run("Add teams");
  await run("Add Eddie Gallagher");
  await run("Import sample NFL players");
  await run("Set $1 floors");
  await run("Keep Justin Jefferson for Beta");
  await run("Lock keepers");
  await expect(page.getByText("Alpha: $350")).toBeVisible();
  await expect(page.getByText("Beta: $300")).toBeVisible();
});
