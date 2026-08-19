import { expect, test } from "@playwright/test";

const rules = { limits: { QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 }, flexEligible: ["RB", "WR", "TE"], flexCapacity: 1 };
const positions = ["QB", "QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "K", "K", "DST", "DST"];

function transport(request, prefix) {
  let serial = 0;
  let version;
  return async (method, path, data) => {
    const response = await request.fetch(path, { method, headers: { ...(data === undefined ? {} : { "content-type": "application/json" }), "idempotency-key": `${prefix}-${++serial}`, ...(version === undefined ? {} : { "x-expected-season-version": String(version) }) }, ...(data === undefined ? {} : { data }) });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
    const result = await response.json();
    if (result?.season?.rowVersion !== undefined) version = result.season.rowVersion;
    return result;
  };
}

async function seedLockedSeason(request, seasonId, playerCount = 28) {
  const send = transport(request, seasonId);
  await send("POST", "/api/setup/seasons", { seasonId, leagueId: `league-${seasonId}`, year: 2026, name: "UI lifecycle", teamCount: 2 });
  await send("GET", `/api/setup/${seasonId}`);
  await send("PUT", `/api/setup/${seasonId}/teams`, { teams: [{ id: "alpha", displayName: "Alpha", seedOrder: 1 }, { id: "beta", displayName: "Beta", seedOrder: 2 }] });
  for (let index = 0; index < playerCount; index++) await send("POST", `/api/setup/${seasonId}/custom-players`, { id: `${seasonId}-p${index}`, name: `Player ${index}`, position: positions[index % 14] });
  await send("PUT", `/api/setup/${seasonId}/pricing`, { floors: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 } });
  await send("POST", `/api/setup/${seasonId}/lock`, { rosterCapacity: 14 });
  return send;
}

async function load(page, seasonId) {
  await page.goto("/");
  await page.getByLabel("Existing season ID").fill(seasonId);
  await page.getByRole("button", { name: "Load season" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
}

async function act(page,button){await button.click();await page.waitForFunction(()=>document.querySelector("fieldset")?.disabled===true);await page.waitForFunction(()=>document.querySelector("fieldset")?.disabled===false);}

async function zeroBidRound(page, round) {
  await act(page,page.getByRole("button", { name: `Open round ${round}` }));
  await act(page,page.getByRole("button", { name: "Finalize zero bids for Alpha" }));
  await act(page,page.getByRole("button", { name: "Finalize zero bids for Beta" }));
  await act(page,page.getByRole("button", { name: `Lock, resolve & reveal round ${round}` }));
  await act(page,page.getByRole("button", { name: `Publish round ${round}` }));
}

test("commissioner UI completes both rounds, order, fixed draft, recovery, and export", async ({ page, request }) => {
  const seasonId = `ui-full-${Date.now()}`;
  await seedLockedSeason(request, seasonId);
  await load(page, seasonId);
  await zeroBidRound(page, 1);
  await expect(page.getByRole("heading", { name: "Auction round 2" })).toBeVisible();
  await zeroBidRound(page, 2);
  await act(page,page.getByRole("button", { name: "Calculate order from Round 2 balances" }));
  await act(page,page.getByRole("button", { name: /Record external order tie/ }));
  await act(page,page.getByRole("button", { name: "Finalize permanent order" }));

  const setup = await (await request.get(`/api/setup/${seasonId}`)).json();
  const draft = await (await request.get(`/api/draft/${seasonId}`)).json();
  const teamIndex = new Map(setup.teams.map((team, index) => [team.seasonTeamId, index]));
  for (let round = 0; round < 14; round++) {
    for (const entry of draft.order) {
      await page.getByLabel("Available player ID").fill(`${seasonId}-p${teamIndex.get(entry.seasonTeamId) * 14 + round}`);
      await act(page,page.getByRole("button", { name: "Commit legal pick" }));
    }
  }
  await page.getByRole("button", { name: "Show recovery summary" }).click();
  await expect(page.getByText("Database integrity: ok; schema 6.")).toBeVisible();
  await page.getByRole("button", { name: "Create CSV & JSON" }).click();
  await expect(page.getByText("Export complete")).toBeVisible();
  await expect(page.getByText(/final-rosters\.json/)).toBeVisible();
});

test("commissioner UI records an auction tie and confirms an audited correction", async ({ page, request }) => {
  const seasonId = `ui-ops-${Date.now()}`;
  await seedLockedSeason(request, seasonId, 1);
  await load(page, seasonId);
  await act(page,page.getByRole("button", { name: "Open round 1" }));
  await page.getByLabel("Bid player ID").fill(`${seasonId}-p0`);
  await act(page,page.getByRole("button", { name: "Finalize bid for Alpha" }));
  await act(page,page.getByRole("button", { name: "Finalize bid for Beta" }));
  await act(page,page.getByRole("button", { name: "Lock, resolve & reveal round 1" }));
  await act(page,page.getByRole("button", { name: /Record external tie winner/ }));
  await act(page,page.getByRole("button", { name: "Publish round 1" }));

  const round = await (await request.get(`/api/auction/${seasonId}/1`)).json();
  await page.getByLabel("Correction type").selectOption("AUCTION_REOPEN");
  await page.getByLabel("Correction target ID").fill(round.roundId);
  await page.getByRole("button", { name: "Preview correction impact" }).click();
  await expect(page.getByText(/Correction affects/)).toBeVisible();
  await page.getByLabel("Correction reason").fill("Correct the recorded external result");
  await page.getByLabel("Typed correction confirmation").fill("CONFIRM ROLLBACK");
  await page.getByRole("button", { name: "Confirm audited rollback" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
  await expect(page.getByText(/Restore is intentionally unavailable/)).toBeVisible();
});

test("loading another season replaces advanced auction and draft UI state", async ({ page, request }) => {
  const currentSeasonId = `ui-current-${Date.now()}`;
  const advancedSeasonId = `ui-advanced-${Date.now()}`;
  const current = await seedLockedSeason(request, currentSeasonId, 1);
  await current("POST", `/api/auction/${currentSeasonId}/1/open`);
  await seedLockedSeason(request, advancedSeasonId, 1);

  await load(page, advancedSeasonId);
  await zeroBidRound(page, 1);
  await zeroBidRound(page, 2);
  await act(page, page.getByRole("button", { name: "Calculate order from Round 2 balances" }));
  await act(page, page.getByRole("button", { name: /Record external order tie/ }));
  await act(page, page.getByRole("button", { name: "Finalize permanent order" }));
  await expect(page.getByText("Pick 1:", { exact: false })).toBeVisible();
  await page.getByLabel("Bid player ID").fill(`${advancedSeasonId}-stale-bid`);
  await page.getByLabel("Available player ID").fill(`${advancedSeasonId}-stale-pick`);

  await page.getByLabel("Existing season ID").fill(currentSeasonId);
  await act(page, page.getByRole("button", { name: "Load season" }));

  await expect(page.getByRole("heading", { name: "Auction round 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Auction round 2" })).toHaveCount(0);
  await expect(page.getByLabel("Bid player ID")).toHaveValue("");
  await expect(page.getByLabel("Available player ID")).toHaveCount(0);
  await expect(page.getByText("Pick 1:", { exact: false })).toHaveCount(0);
});
