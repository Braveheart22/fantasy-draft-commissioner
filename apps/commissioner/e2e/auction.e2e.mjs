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
