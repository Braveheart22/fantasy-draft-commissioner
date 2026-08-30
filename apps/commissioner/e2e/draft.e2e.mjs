import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("external order tie resolution drives a complete fixed-order draft control room", async ({ page, request }) => {
  let serial = 0; let version; const seasonId = `draft-e2e-${Date.now()}`; const headers = (data,method,path) => ({ ...(data === undefined ? {} : { "content-type": "application/json" }), "idempotency-key": `draft-${++serial}`, ...(version!==undefined&&method!=="GET"&&path!=="/api/setup/seasons"?{"x-expected-season-version":String(version)}:{}) });
  const send = async (method, path, data, ok = true) => { const response = await request.fetch(path, { method, headers: headers(data,method,path), ...(data === undefined ? {} : { data }) }); expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(ok); const result=await response.json();if(result?.season?.rowVersion!==undefined)version=result.season.rowVersion;else if(result?.rowVersion!==undefined)version=result.rowVersion;else if(method!=="GET"){const summary=await request.get(`/api/setup/${seasonId}`);version=(await summary.json()).season.rowVersion;}return result; };
  const rules = { limits: { QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 }, flexEligible: ["RB", "WR", "TE"], flexCapacity: 1 };
  const positions = ["QB", "QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "K", "K", "DST", "DST"];
  await send("POST", "/api/setup/seasons", { seasonId, leagueId: `league-${seasonId}`, year: 2026, name: "Draft browser proof", teamCount: 2 });
  await send("PUT", `/api/setup/${seasonId}/teams`, { teams: [{ id: "alpha", displayName: "Alpha", seedOrder: 1 }, { id: "beta", displayName: "Beta", seedOrder: 2 }] });
  for (let i = 0; i < 28; i++) await send("POST", `/api/setup/${seasonId}/custom-players`, { id: `${seasonId}-p${i}`, name: `Player ${i}`, position: positions[i % 14] });
  await send("PUT", `/api/setup/${seasonId}/pricing`, { floors: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 } }); await send("POST", `/api/setup/${seasonId}/lock`, { rosterCapacity: 14 });
  for (const round of [1, 2]) { const opened = await send("POST", `/api/auction/${seasonId}/${round}/open`); for (const team of opened.teams) await send("PUT", `/api/auction/${seasonId}/${round}/teams/${team.seasonTeamId}`, { bids: [], finalize: true, confirmZero: true }); expect((await send("POST", `/api/auction/${seasonId}/${round}/lock`, {})).status).toBe("RESOLVED"); await send("POST", `/api/auction/${seasonId}/${round}/publish`); }
  const paused = await send("POST", `/api/draft/${seasonId}/order/calculate`); expect(paused.status).toBe("TIE_PAUSED"); const tie = paused.ties[0]; await send("POST", `/api/draft/${seasonId}/order/ties`, { balance: tie.balance, participantTeamIds: tie.seasonTeamIds, precedenceTeamIds: [...tie.seasonTeamIds].reverse(), method: "external draw", decidedAt: "2026-08-17T00:00:00.000Z" }); const order = await send("POST", `/api/draft/${seasonId}/order/finalize`); expect(order.order).toHaveLength(2);
  await page.goto("/");
  await page.getByLabel("Existing season ID").fill(seasonId);
  await page.getByRole("button", { name: "Load season" }).click();
  const pickInUi = async (playerName, nextTeam) => {
    await page.getByLabel("Available player search").fill(playerName);
    await page.getByLabel("Available player search").press("Enter");
    await page.getByLabel("Available player", { exact: true }).getByRole("button", { name: new RegExp(`^${playerName} ·`) }).click();
    await page.getByRole("button", { name: new RegExp(`^Commit legal pick: ${playerName}$`) }).click();
    await expect(page.getByRole("heading", { name: `${nextTeam} is on the clock` })).toBeVisible();
    await expect(page.getByText(new RegExp(`^Pick \\d+ · ${playerName} ·`))).toBeVisible();
  };
  await pickInUi("Player 0", order.order[1].displayName);
  await pickInUi("Player 14", order.order[0].displayName);
  await pickInUi("Player 1", order.order[1].displayName);
  await expect(page.getByText("Round 2 · Overall pick 4")).toBeVisible();
  version=(await (await request.get(`/api/setup/${seasonId}`)).json()).season.rowVersion;
  for (let overall = 3; overall < 28; overall++) { const round = Math.floor(overall / 2); const position = overall % 2; const result = await send("POST", `/api/draft/${seasonId}/picks`, { seasonTeamId: order.order[position].seasonTeamId, playerId: `${seasonId}-p${position * 14 + round}`, rosterRules: rules }); if (round === 13 && position === 1) expect(result.status).toBe("COMPLETED"); }
  const exported=await send("POST",`/api/exports/${seasonId}`,{destinationDirectory:join(tmpdir(),`commissioner-export-${seasonId}`),rosterRules:rules});expect(exported.backupId).toBeTruthy();expect(JSON.parse(await readFile(exported.jsonPath,"utf8")).rosters).toHaveLength(2);expect(await readFile(exported.csvPath,"utf8")).toContain("acquisition_source");
});
