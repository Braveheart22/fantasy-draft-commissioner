import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./setup.css";
import { OperationsPanel } from "../operations/operations-panel.jsx";
import { ExportsPanel } from "../exports/exports-panel.jsx";

const key = () => crypto.randomUUID();
async function api(path, method = "GET", body) {
  const response = await fetch(path, { method, headers: { "content-type": "application/json", "idempotency-key": key() }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

function SetupApp() {
  const [seasonId, setSeasonId] = useState("");
  const [summary, setSummary] = useState(null);
  const [message, setMessage] = useState("Create a season to begin.");
  const run = async action => { setMessage("Saving…"); try { const result = await action(); if (result?.season) setSummary(result); setMessage("Saved"); } catch (error) { setMessage(error.message); } };
  const [auction, setAuction] = useState(null);
  const [draft, setDraft] = useState(null);
  const [draftPlayerId, setDraftPlayerId] = useState("");
  const runAuction = action => run(async () => { const result = await action(); if (result?.teams) setAuction(result); return result; });
  return <main><header><p className="eyebrow">Local commissioner console</p><h1>Draft setup & sealed auctions</h1><p>{message}</p></header>
    <section><h2>1. Season</h2><button onClick={() => run(async () => { const id = crypto.randomUUID(); const result = await api("/api/setup/seasons", "POST", { seasonId: id, leagueId: "local-league", year: new Date().getFullYear(), name: "League Draft", teamCount: 2 }); setSeasonId(id); return result; })}>Create two-team season</button></section>
    <section><h2>2. Teams & catalog</h2><button disabled={!seasonId} onClick={() => run(() => api(`/api/setup/${seasonId}/teams`, "PUT", { teams: [{ id: "alpha", displayName: "Alpha", seedOrder: 1 }, { id: "beta", displayName: "Beta", seedOrder: 2 }] }))}>Add teams</button><button disabled={!seasonId} onClick={() => run(() => api(`/api/setup/${seasonId}/custom-players`, "POST", { id: "eddie-gallagher", name: "Eddie Gallagher", position: "K" }))}>Add Eddie Gallagher</button><button disabled={!seasonId} onClick={() => run(async () => { const content = JSON.stringify([{ externalId: "jj-18", name: "Justin Jefferson", position: "WR" }]); const preview = await api(`/api/setup/${seasonId}/imports/preview`, "POST", { namespace: "sample-nfl", content, format: "json" }); if (preview.errors.length || preview.reviews.length) throw new Error("Import needs review"); await api(`/api/setup/${seasonId}/imports`, "POST", { namespace: "sample-nfl", format: "json", preview }); return api(`/api/setup/${seasonId}`); })}>Import sample NFL players</button></section>
    <section><h2>3. Preflight</h2><button disabled={!seasonId} onClick={() => run(() => api(`/api/setup/${seasonId}/pricing`, "PUT", { floors: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 } }))}>Set $1 floors</button><button disabled={!summary?.players?.some(player => player.name === "Justin Jefferson")} onClick={() => run(async () => { const playerId = summary.players.find(player => player.name === "Justin Jefferson").id; const teamId = summary.teams.find(team => team.displayName === "Beta").seasonTeamId; await api(`/api/setup/${seasonId}/keeper-eligibility`, "PUT", { playerIds: [playerId] }); return api(`/api/setup/${seasonId}/teams/${teamId}/keeper`, "PUT", { playerId }); })}>Keep Justin Jefferson for Beta</button><button disabled={!seasonId} onClick={() => run(() => api(`/api/setup/${seasonId}/lock`, "POST", { rosterCapacity: 14 }))}>Lock keepers</button></section>
    {summary && <section><h2>Budgets</h2><ul>{summary.teams.map(team => <li key={team.id}>{team.displayName}: ${team.startingBudget}</li>)}</ul></section>}
    {seasonId && <section><h2>Auction round 1</h2><p>Team contents remain masked until the round is locked and explicitly revealed.</p><button onClick={() => runAuction(() => api(`/api/auction/${seasonId}/1/open`, "POST"))}>Open round</button>{auction?.teams?.map(team => <button key={team.seasonTeamId} disabled={auction.status !== "BIDDING"} onClick={() => runAuction(async () => { await api(`/api/auction/${seasonId}/1/teams/${team.seasonTeamId}`, "PUT", { bids: [], finalize: true, confirmZero: true }); return api(`/api/auction/${seasonId}/1`); })}>Finalize {team.displayName}: zero bids</button>)}<button disabled={!auction || auction.status !== "BIDDING"} onClick={() => run(async () => { await api(`/api/auction/${seasonId}/1/lock`, "POST", {}); const revealed = await api(`/api/auction/${seasonId}/1?reveal=true`); setAuction(revealed); return revealed; })}>Lock, resolve & reveal</button><button disabled={auction?.status !== "REVIEW"} onClick={() => runAuction(() => api(`/api/auction/${seasonId}/1/publish`, "POST"))}>Publish round</button>{auction && <ul>{auction.teams.map(team => <li key={team.seasonTeamId}>{team.displayName}: {team.status}, {team.bidCount} bid(s){auction.revealed ? " — revealed" : " — masked"}</li>)}</ul>}</section>}
    {seasonId && <section><h2>Permanent conventional draft</h2><button onClick={() => run(async () => { const result = await api(`/api/draft/${seasonId}/order/calculate`, "POST"); setDraft(result); return result; })}>Calculate order from Round 2 balances</button>{draft?.order?.length > 0 && <ol>{draft.order.map(team => <li key={team.seasonTeamId}>{team.displayName} — ${team.remainingBalance}</li>)}</ol>}{draft?.ties?.length > 0 && <p>{draft.ties.length} tied balance group(s) require recorded external precedence.</p>}{draft?.currentSeasonTeamId && <><p>Pick {draft.nextOverallPick}: {draft.order.find(team => team.seasonTeamId === draft.currentSeasonTeamId)?.displayName} is on the clock. The same order repeats every round.</p><label>Available player ID <input value={draftPlayerId} onChange={event => setDraftPlayerId(event.target.value)} /></label><button disabled={!draftPlayerId} onClick={() => run(async () => { const result = await api(`/api/draft/${seasonId}/picks`, "POST", { seasonTeamId: draft.currentSeasonTeamId, playerId: draftPlayerId, rosterRules: { limits: { QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 }, flexEligible: ["RB", "WR", "TE"], flexCapacity: 1 } }); setDraft(result); setDraftPlayerId(""); return result; })}>Commit legal pick</button></>}</section>}
    <OperationsPanel seasonId={seasonId || undefined} />
    <ExportsPanel seasonId={seasonId || undefined} />
  </main>;
}
createRoot(document.getElementById("root")).render(<SetupApp />);
