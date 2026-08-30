import { expect, test } from "@playwright/test";

test("both auction rounds lock, reveal, resolve forced tie, resume, publish, and derive Round 2 budgets", async ({ request }) => {
  let serial = 0; let version; const seasonId = `auction-e2e-${Date.now()}`; const headers = (data,method,path) => ({ ...(data === undefined ? {} : { "content-type": "application/json" }), "idempotency-key": `e2e-${++serial}`, ...(version!==undefined&&method!=="GET"&&path!=="/api/setup/seasons"?{"x-expected-season-version":String(version)}:{}) });
  const send = async (method, path, data) => { const response = await request.fetch(path, { method, headers: headers(data,method,path), ...(data === undefined ? {} : { data }) }); expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy(); const result=await response.json();if(result?.season?.rowVersion!==undefined)version=result.season.rowVersion;else if(result?.rowVersion!==undefined)version=result.rowVersion;else if(method!=="GET"){const summary=await request.get(`/api/setup/${seasonId}`);version=(await summary.json()).season.rowVersion;}return result; };
  await send("POST", "/api/setup/seasons", { seasonId, leagueId: `league-${seasonId}`, year: 2026, name: "Auction proof", teamCount: 2 });
  await send("PUT", `/api/setup/${seasonId}/teams`, { teams: [{ id: "alpha", displayName: "Alpha", seedOrder: 1 }, { id: "beta", displayName: "Beta", seedOrder: 2 }] });
  await send("POST", `/api/setup/${seasonId}/custom-players`, { id: `${seasonId}-p1`, name: "Tie Kicker", position: "K" });
  await send("PUT", `/api/setup/${seasonId}/pricing`, { floors: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 } });
  await send("POST", `/api/setup/${seasonId}/lock`, { rosterCapacity: 14 });
  const round1 = await send("POST", `/api/auction/${seasonId}/1/open`); const [alpha, beta] = round1.teams;
  await send("PUT", `/api/auction/${seasonId}/1/teams/${alpha.seasonTeamId}`, { bids: [{ playerId: `${seasonId}-p1`, amount: 10 }], finalize: true });
  await send("PUT", `/api/auction/${seasonId}/1/teams/${beta.seasonTeamId}`, { bids: [{ playerId: `${seasonId}-p1`, amount: 10 }], finalize: true });
  const masked = await send("GET", `/api/auction/${seasonId}/1`); expect(masked.revealed).toBe(false); expect(masked.teams[0].bids).toBeUndefined();
  const tie = await send("POST", `/api/auction/${seasonId}/1/lock`, {}); expect(tie.status).toBe("UNRESOLVED_TIE");
  const paused = await send("GET", `/api/auction/${seasonId}/1?reveal=true`); expect(paused.teams[0].bids[0].amount).toBe(10);
  const unresolved = tie.unresolvedTies[0]; const resolved = await send("POST", `/api/auction/${seasonId}/1/ties`, { tieKey: unresolved.key, playerId: unresolved.playerId, amount: unresolved.amount, participantTeamIds: unresolved.teamIds, preferredTeamId: "alpha", method: "coin flip", note: "heads", decidedAt: "2026-08-17T00:00:00.000Z" }); expect(resolved.status).toBe("RESOLVED");
  const published1 = await send("POST", `/api/auction/${seasonId}/1/publish`); const round2 = await send("POST", `/api/auction/${seasonId}/2/open`);
  for (const balance of round2.balances) expect(balance.startingBudget).toBe(150 + published1.balances.find(item => item.seasonTeamId === balance.seasonTeamId).remainingBudget);
  for (const team of round2.teams) await send("PUT", `/api/auction/${seasonId}/2/teams/${team.seasonTeamId}`, { bids: [], finalize: true, confirmZero: true });
  expect((await send("POST", `/api/auction/${seasonId}/2/lock`, {})).status).toBe("RESOLVED"); expect((await send("POST", `/api/auction/${seasonId}/2/publish`)).status).toBe("PUBLISHED");
});

test("commissioner privately saves, rehydrates, finalizes, reveals, and publishes both auction rounds by player name", async ({ page }) => {
  await page.goto("/");
  const run = async name => {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByText("Saving…")).toBeVisible();
    await expect(page.getByText("Saved")).toBeVisible();
  };
  await run("Create two-team season");
  await run("Add teams");
  await run("Add Eddie Gallagher");
  await run("Set $1 floors");
  await page.getByLabel("I reviewed every team and confirm keeper lock").check();
  await page.getByRole("button", { name: "Lock reviewed keepers" }).click();
  await page.getByRole("button", { name: "Open round 1" }).click();
  await expect(page.getByRole("heading", { name: "Alpha bid entry" })).toBeVisible();

  await page.getByLabel("Priority 1 player search").fill("Eddie Gallagher");
  await page.getByLabel("Priority 1 player search").press("Enter");
  await page.getByLabel("Priority 1 player", { exact: true }).getByRole("button", { name: /^Eddie Gallagher ·/ }).click();
  await page.getByLabel("Priority 1 amount").fill("10");
  await page.getByRole("link", { name: "Keepers", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Unsaved bid changes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alpha bid entry" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.getByRole("button", { name: "Beta · DRAFT · 0 bid(s)", exact: true }).click();
  await page.getByRole("button", { name: "Save draft and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Beta bid entry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Alpha · DRAFT · 1 bid(s)", exact: true })).toBeVisible();
  await page.getByLabel("Priority 1 amount").fill("99");
  await page.getByRole("button", { name: "Alpha · DRAFT · 1 bid(s)", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alpha bid entry" })).toBeVisible();
  const seasonId = await page.getByLabel("Existing season ID").inputValue();
  await page.reload();
  await page.getByLabel("Existing season ID").fill(seasonId);
  await page.getByRole("button", { name: "Load season", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alpha bid entry" })).toBeVisible();
  await expect(page.getByText("Eddie Gallagher · K · $1 minimum")).toBeVisible();

  let releaseStaleHydration;
  let delayNextHydration = true;
  await page.route("**/submission", async route => {
    if (!delayNextHydration) return route.continue();
    delayNextHydration = false;
    await new Promise(resolve => { releaseStaleHydration = resolve; });
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Beta · DRAFT · 0 bid(s)", exact: true }).click();
  await page.getByRole("button", { name: "Alpha · DRAFT · 1 bid(s)", exact: true }).click();
  await expect(page.getByText("1 saved bid; draft.")).toBeVisible();
  releaseStaleHydration();
  await expect(page.getByText("1 saved bid; draft.")).toBeVisible();
  await page.unroute("**/submission");

  await page.getByRole("button", { name: "Beta · DRAFT · 0 bid(s)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Beta bid entry" })).toBeVisible();
  await page.getByRole("button", { name: "Finalize zero bids", exact: true }).click();
  await page.getByRole("button", { name: "Alpha · DRAFT · 1 bid(s)", exact: true }).click();
  await expect(page.getByText("Eddie Gallagher · K · $1 minimum")).toBeVisible();
  await page.getByLabel("Priority 1 amount").fill("25");
  await page.getByRole("button", { name: "Finalize saved draft", exact: true }).click();
  await page.getByRole("button", { name: "Lock, resolve & reveal round 1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Revealed submissions" })).toBeVisible();
  await expect(page.getByText("Priority 1: Eddie Gallagher · $10")).toBeVisible();
  await page.getByRole("button", { name: "Publish round 1", exact: true }).click();

  await page.getByRole("button", { name: "Open round 2", exact: true }).click();
  await page.getByRole("button", { name: "Finalize zero bids", exact: true }).click();
  await page.getByRole("button", { name: "Beta · DRAFT · 0 bid(s)", exact: true }).click();
  await page.getByRole("button", { name: "Finalize zero bids", exact: true }).click();
  await page.getByRole("button", { name: "Lock, resolve & reveal round 2", exact: true }).click();
  await page.getByRole("button", { name: "Publish round 2", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Draft Order" })).toBeVisible();
});
