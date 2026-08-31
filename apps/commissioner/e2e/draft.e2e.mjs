import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("external order tie resolution drives a complete fixed-order draft control room", async ({ page, request }) => {
  await page.setViewportSize({width:1366,height:768});
  let serial = 0; let version; const seasonId = `draft-e2e-${Date.now()}`; const headers = (data,method,path) => ({ ...(data === undefined ? {} : { "content-type": "application/json" }), "idempotency-key": `draft-${++serial}`, ...(version!==undefined&&method!=="GET"&&path!=="/api/setup/seasons"?{"x-expected-season-version":String(version)}:{}) });
  const send = async (method, path, data, ok = true) => { const response = await request.fetch(path, { method, headers: headers(data,method,path), ...(data === undefined ? {} : { data }) }); expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(ok); const result=await response.json();if(result?.season?.rowVersion!==undefined)version=result.season.rowVersion;else if(result?.rowVersion!==undefined)version=result.rowVersion;else if(method!=="GET"){const summary=await request.get(`/api/setup/${seasonId}`);version=(await summary.json()).season.rowVersion;}return result; };
  const rules = { limits: { QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 }, flexEligible: ["RB", "WR", "TE"], flexCapacity: 1 };
  const positions = ["QB", "QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "K", "K", "DST", "DST"];
  await send("POST", "/api/setup/seasons", { seasonId, leagueId: `league-${seasonId}`, year: 2026, name: "Draft browser proof", teamCount: 2 });
  await send("PUT", `/api/setup/${seasonId}/teams`, { teams: [{ id: "alpha", displayName: "Alpha", seedOrder: 1 }, { id: "beta", displayName: "Beta", seedOrder: 2 }] });
  for (let i = 0; i < 28; i++) await send("POST", `/api/setup/${seasonId}/custom-players`, { id: `${seasonId}-p${i}`, name: `Player ${i}`, position: positions[i % 14] });
  await send("POST", `/api/setup/${seasonId}/custom-players`, { id: `${seasonId}-extra-k`, name: "Extra kicker", position: "K" });
  await send("PUT", `/api/setup/${seasonId}/pricing`, { floors: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 } }); await send("POST", `/api/setup/${seasonId}/lock`, { rosterCapacity: 14 });
  for (const round of [1, 2]) { const opened = await send("POST", `/api/auction/${seasonId}/${round}/open`); for (const team of opened.teams) await send("PUT", `/api/auction/${seasonId}/${round}/teams/${team.seasonTeamId}`, { bids: [], finalize: true, confirmZero: true }); expect((await send("POST", `/api/auction/${seasonId}/${round}/lock`, {})).status).toBe("RESOLVED"); await send("POST", `/api/auction/${seasonId}/${round}/publish`); }
  await page.goto("/");
  await page.getByLabel("Existing season ID").fill(seasonId);
  await page.getByRole("button", { name: "Load season" }).click();
  // Every order command remains acknowledged, non-retryable, and mounted when
  // its follow-up hydration fails. Explicit reload recovers the canonical state.
  const orderActionWithRefreshFailure = async name => {
    const before = (await (await request.get(`/api/setup/${seasonId}`)).json()).season.rowVersion;
    await page.route(`**/api/bootstrap/${seasonId}`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporary hydration failure" }) }));
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByText("Draft order saved, but the season refresh failed. Reload draft order before continuing.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finalize permanent order", exact: true })).toBeDisabled();
    await page.getByRole("link", { name: "Setup", exact: true }).click();
    await page.evaluate(() => { location.hash = "stage/KEEPERS"; });
    await expect(page).toHaveURL(/#stage\/DRAFT_ORDER$/);
    await expect(page.getByRole("button", { name: "Reload draft order", exact: true })).toBeVisible();
    await page.unroute(`**/api/bootstrap/${seasonId}`);
    await page.getByRole("button", { name: "Reload draft order", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reload draft order", exact: true })).toHaveCount(0);
    expect((await (await request.get(`/api/setup/${seasonId}`)).json()).season.rowVersion).toBe(before + 1);
  };
  await orderActionWithRefreshFailure("Calculate order from Round 2 balances");
  // No keeper or auction spend: $350 carries over, plus the $150 Round 2 budget.
  await page.getByLabel("Precedence 1 at $500").selectOption({ label: "Beta" });
  await page.getByLabel("Precedence 2 at $500").selectOption({ label: "Alpha" });
  await page.getByLabel("Tie decision method at $500").fill("external draw");
  await orderActionWithRefreshFailure("Record external order tie at $500");
  await orderActionWithRefreshFailure("Finalize permanent order");
  const order = await (await request.get(`/api/draft/${seasonId}`)).json();
  expect(order.order.map(team => team.displayName)).toEqual(["Beta", "Alpha"]);
  await expect(page.getByRole("heading", {name:"Fixed draft order"})).toBeVisible();
  const clock=page.locator(".draft-clock");
  await expect(clock).toBeInViewport();
  expect(await page.locator(".draft-panes").evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  const pickInUi = async (playerName, nextTeam, duringPending = async () => {}) => {
    await page.getByLabel("Available player search").fill(playerName);
    await page.getByLabel("Available player search").press("Enter");
    await page.getByLabel("Available player", { exact: true }).getByRole("button", { name: new RegExp(`^${playerName} ·`) }).click();
    await page.getByRole("button", { name: new RegExp(`^Commit legal pick: ${playerName}$`) }).click();
    await duringPending();
    await expect(page.getByRole("heading", { name: `${nextTeam} is on the clock` })).toBeVisible();
    await expect(page.getByText(new RegExp(`^Pick \\d+ · ${playerName} ·`))).toBeVisible();
    await expect(page.getByLabel("Available player search")).toHaveValue(playerName);
    await expect(page.getByLabel("Available player", {exact:true}).getByRole("button",{name:new RegExp(`^${playerName} ·`)})).toHaveCount(0);
  };
  // Acknowledged pick is still shown even when its following bootstrap fails.
  await page.route(`**/api/bootstrap/${seasonId}`,route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({message:"Temporary hydration failure"})}));
  let releasePick;
  const heldPick = new Promise(resolve => { releasePick = resolve; });
  await page.route(`**/api/draft/${seasonId}/picks`, async route => {
    const response = await route.fetch();
    await heldPick;
    await route.fulfill({ response });
  });
  await pickInUi("Player 0", order.order[1].displayName, async () => {
    await page.getByRole("link", { name: "Setup", exact: true }).click();
    await page.evaluate(() => { location.hash = "stage/KEEPERS"; });
    await expect(page).toHaveURL(/#stage\/DRAFT$/);
    await expect(page.getByText("Committing pick.")).toBeVisible();
    releasePick();
  });
  await page.unroute(`**/api/draft/${seasonId}/picks`);
  await expect(page.getByText("Pick saved, but the season refresh failed. Reload draft state before continuing.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Commit legal pick",exact:true})).toBeDisabled();
  await page.getByRole("link", { name: "Setup", exact: true }).click();
  await page.evaluate(() => { location.hash = "stage/KEEPERS"; });
  await expect(page).toHaveURL(/#stage\/DRAFT$/);
  await expect(page.getByRole("button", { name: "Reload draft state" })).toBeVisible();
  await page.unroute(`**/api/bootstrap/${seasonId}`);
  await page.getByRole("button",{name:"Reload draft state"} ).click();
  await expect(page.getByRole("button",{name:"Reload draft state"})).toHaveCount(0);
  await pickInUi("Player 14", order.order[0].displayName);
  await pickInUi("Player 1", order.order[1].displayName);
  await expect(page.getByText("Round 2 · Overall pick 4")).toBeVisible();
  await expect(page.getByRole("tab",{name:`${order.order[0].displayName} roster`})).toHaveAttribute("aria-selected","true");
  await expect(page.getByLabel(`${order.order[0].displayName} roster details`)).toContainText("QB (2)");
  await page.setViewportSize({width:1000,height:768});
  await page.getByRole("tab",{name:"Recent history",exact:true}).click();
  await expect(page.getByText(/^Pick 3 · Player 1 ·/)).toBeVisible();
  expect(await page.locator(".draft-panes").evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.setViewportSize({width:1366,height:768});
  // A delivery failure must not erase the attempted selection or filters, nor create a canonical pick.
  const beforeFailure=await (await request.get(`/api/setup/${seasonId}`)).json();
  await page.getByLabel("Available player search").fill("Player 15");
  await page.getByLabel("Available player search").press("Enter");
  await page.getByLabel("Available player",{exact:true}).getByRole("button",{name:/^Player 15 ·/}).click();
  await page.route(`**/api/draft/${seasonId}/picks`,route=>route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({code:"ROSTER_CAPACITY_EXCEEDED",message:"No legal capacity remains for QB."})}));
  await page.getByRole("button",{name:"Commit legal pick: Player 15",exact:true}).click();
  await expect(page.getByText("No legal capacity remains for QB.")).toBeVisible();
  await expect(page.getByText("Selected: Player 15 · QB")).toBeVisible();
  await expect(page.getByLabel("Available player search")).toHaveValue("Player 15");
  expect((await (await request.get(`/api/setup/${seasonId}`)).json()).season.rowVersion).toBe(beforeFailure.season.rowVersion);
  await page.unroute(`**/api/draft/${seasonId}/picks`);
  version=(await (await request.get(`/api/setup/${seasonId}`)).json()).season.rowVersion;
  for (let overall = 3; overall < 28; overall++) {
    if (overall === 24) {
      // Both teams own two kickers. Exercise the real Phase 1-backed rejection,
      // rather than only a mocked transport envelope, and retain the attempt.
      await page.reload();
      await page.getByLabel("Existing season ID").fill(seasonId);
      await page.getByRole("button", { name: "Load season", exact: true }).click();
      await page.getByLabel("Available player search").fill("Extra kicker");
      await page.getByLabel("Available player search").press("Enter");
      await page.getByLabel("Available player", { exact: true }).getByRole("button", { name: /^Extra kicker ·/ }).click();
      const before = await (await request.get(`/api/draft/${seasonId}`)).json();
      const rejected = page.waitForResponse(response => response.url().endsWith(`/api/draft/${seasonId}/picks`) && response.request().method() === "POST");
      await page.getByRole("button", { name: "Commit legal pick: Extra kicker", exact: true }).click();
      expect((await rejected).status()).toBe(409);
      await expect(page.getByText(/Illegal partial roster/)).toBeVisible();
      await expect(page.getByText("Selected: Extra kicker · K")).toBeVisible();
      await expect(page.getByLabel("Available player search")).toHaveValue("Extra kicker");
      expect(await (await request.get(`/api/draft/${seasonId}`)).json()).toEqual(before);
    }
    const round = Math.floor(overall / 2); const position = overall % 2;
    const result = await send("POST", `/api/draft/${seasonId}/picks`, { seasonTeamId: order.order[position].seasonTeamId, playerId: `${seasonId}-p${position * 14 + round}`, rosterRules: rules });
    if (round === 13 && position === 1) expect(result.status).toBe("COMPLETED");
  }
  const exported=await send("POST",`/api/exports/${seasonId}`,{destinationDirectory:join(tmpdir(),`commissioner-export-${seasonId}`),rosterRules:rules});expect(exported.backupId).toBeTruthy();expect(JSON.parse(await readFile(exported.jsonPath,"utf8")).rosters).toHaveLength(2);expect(await readFile(exported.csvPath,"utf8")).toContain("acquisition_source");
  // A fresh app entry requires explicit season selection; no old stage deep link.
  await page.goto("/");
  await page.getByLabel("Existing season ID").fill(seasonId);
  await page.getByRole("button", { name: "Load season", exact: true }).click();
  await expect(page.getByRole("heading",{name:"Results",exact:true})).toBeVisible();
  await expect(page.getByText("The season is complete.")).toBeVisible();
  await expect(page.getByRole("button",{name:/Commit legal pick/})).toHaveCount(0);
});
