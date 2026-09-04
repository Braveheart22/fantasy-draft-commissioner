import { expect, test } from "@playwright/test";

test("explicit demo profile is reachable while production UI has no demo setup actions", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Deterministic demo profile" })).toBeVisible();
  await page.getByRole("button", { name: "Create prepared demo season" }).click();
  await expect(page.getByRole("status")).toContainText("Created demo season demo-");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Create season" })).toBeVisible();
  for (const name of ["Create two-team season", "Add Eddie Gallagher", "Import sample NFL players", "Set $1 floors"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
});

test("production setup controls create and persist user-provided data", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("Season name").fill("Browser league");
  await page.getByLabel("Season year").fill("-1");
  await page.getByLabel("Team count").fill("2");
  await expect(page.getByRole("button", { name: "Create season" })).toBeDisabled();
  await page.getByLabel("Season year").fill("2026");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
  const seasonId = await page.getByLabel("Existing season ID").inputValue();
  await page.getByLabel("Team names, one per line").fill("Owls\nFoxes");
  await page.getByRole("button", { name: "Save teams" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
  await page.getByLabel("Custom player name").first().fill("Taylor Example");
  await page.getByLabel("Custom player position").first().selectOption("K");
  await page.getByRole("button", { name: "Add custom player" }).click();
  await expect(page.getByText("Taylor Example (K) — missing")).toBeVisible();
  await page.getByLabel("Default positional floor").first().fill("2");
  await page.getByRole("button", { name: "Save positional floors" }).first().click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
  await page.reload();
  await page.getByLabel("Existing season ID").fill(seasonId);
  await page.getByRole("button", { name: "Load season" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
  const response = await request.get(`/api/setup/${seasonId}`);
  expect(response.ok()).toBe(true);
  const summary = await response.json();
  expect(summary.teams.map(team => team.displayName)).toEqual(["Owls", "Foxes"]);
  expect(summary.players).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Taylor Example", position: "K", minimumBid: 2 })]));
  expect(summary.floors).toMatchObject({ QB: 2, RB: 2, WR: 2, TE: 2, K: 2, DST: 2 });
});
