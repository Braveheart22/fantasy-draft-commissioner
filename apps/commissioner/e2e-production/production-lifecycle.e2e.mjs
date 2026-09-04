import { expect, test } from "@playwright/test";
import { act, load, recordExternalTie, reloadSeason, seedLockedSeason, selectPlayer, zeroBidRound } from "../e2e-support/lifecycle.mjs";

test("packaged production profile completes and resumes an offline full draft without demo routes", async ({ page, request }) => {
  const seasonId = `production-lifecycle-${Date.now()}`;
  const controlPort = Number(process.env.COMMISSIONER_PRODUCTION_E2E_PORT ?? 4193) + 1000;
  await seedLockedSeason(request, seasonId, 28, { playerPrefix: "Offline Player", seasonName: "Production rehearsal" });
  await load(page, seasonId);
  await expect(page.getByRole("heading", { name: "Auction round 1" })).toBeVisible();
  expect((await request.post("/api/demo/seasons", { data: { seasonId: "forbidden", preset: "EMPTY" } })).status()).toBe(404);

  await zeroBidRound(page, 1);
  expect((await request.post(`http://127.0.0.1:${controlPort}/restart`)).status()).toBe(204);
  await reloadSeason(page, seasonId);
  await expect(page.getByRole("heading", { name: "Auction round 2" })).toBeVisible();
  await zeroBidRound(page, 2);
  await act(page, page.getByRole("button", { name: "Calculate order from Round 2 balances" }));
  await recordExternalTie(page, "Witnessed production rehearsal draw");
  await act(page, page.getByRole("button", { name: "Finalize permanent order" }));

  const [setupResponse, draftResponse] = await Promise.all([request.get(`/api/setup/${seasonId}`), request.get(`/api/draft/${seasonId}`)]);
  const [setup, draft] = await Promise.all([setupResponse.json(), draftResponse.json()]);
  const teamIndex = new Map(setup.teams.map((team, index) => [team.seasonTeamId, index]));
  for (let round = 0; round < 14; round++) {
    for (const entry of draft.order) {
      await selectPlayer(page, "Available player", `Offline Player ${teamIndex.get(entry.seasonTeamId) * 14 + round}`);
      await act(page, page.getByRole("button", { name: "Commit legal pick" }));
    }
    if (round === 6) {
      expect((await request.post(`http://127.0.0.1:${controlPort}/restart`)).status()).toBe(204);
      await reloadSeason(page, seasonId);
      await expect(page.getByText("Round 8 · Overall pick 15", { exact: true })).toBeVisible();
    }
  }

  await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create CSV & JSON" }).click();
  await expect(page.getByText("Export complete")).toBeVisible();
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("button", { name: "Show recovery summary" }).click();
  await expect(page.getByText("Database integrity: ok; schema 11.")).toBeVisible();
});
