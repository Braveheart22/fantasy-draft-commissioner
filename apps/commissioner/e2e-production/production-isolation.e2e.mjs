import { expect, test } from "@playwright/test";

test("production profile serves normal UI without demo routes", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Create season" })).toBeVisible();
  expect((await request.get("/demo")).status()).toBe(404);
  expect((await request.post("/api/demo/seasons", { data: { preset: "PREPARED" } })).status()).toBe(404);
});
