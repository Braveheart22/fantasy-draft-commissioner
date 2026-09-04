import { expect } from "@playwright/test";

export async function createDemoSeason(request, preset = "PREPARED") {
  const seasonId = `demo-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await request.post("/api/demo/seasons", { data: { seasonId, preset } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { seasonId, summary: await response.json() };
}

export async function loadSeason(page, seasonId) {
  await page.goto("/");
  await page.getByLabel("Existing season ID").fill(seasonId);
  await page.getByRole("button", { name: "Load season", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
}
