import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./setup.css";
import { OperationsPanel } from "../operations/operations-panel.jsx";
import { ExportsPanel } from "../exports/exports-panel.jsx";
import { LifecycleState } from "../../application/ports/season-repository.js";
import { createApiClient, createSeasonActivation } from "../shared/api-client.js";
import { StageShell } from "../app/stage-shell.jsx";
import { CatalogPreparationPanel } from "../stages/setup/catalog-preparation-panel.jsx";
import { PricingPreparationPanel } from "../stages/setup/pricing-preparation-panel.jsx";
import { PlayerFinder } from "../shared/player-finder.jsx";
import { KeepersPanel } from "../stages/keepers/keepers-panel.jsx";

const client = createApiClient();
const activation = createSeasonActivation(client);
const draftRules = { limits: { QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 }, flexEligible: ["RB", "WR", "TE"], flexCapacity: 1 };
const roundOneAuctionStates = new Set([LifecycleState.R1_BIDDING, LifecycleState.R1_TIE_PAUSED, LifecycleState.R1_REVIEW]);
const draftStates = new Set([LifecycleState.ORDER_TIE_PAUSED, LifecycleState.ORDER_FINAL, LifecycleState.CONVENTIONAL_DRAFT, LifecycleState.COMPLETED]);
const roundTwoAuctionStates = new Set([LifecycleState.R2_BIDDING, LifecycleState.R2_TIE_PAUSED, LifecycleState.R2_REVIEW, LifecycleState.R2_PUBLISHED, ...draftStates]);
const roundTwoViewStates = new Set([LifecycleState.R1_PUBLISHED, ...roundTwoAuctionStates]);
const api = (...args) => client.request(...args);

function SetupApp() {
  const [seasonId, setSeasonId] = useState("");
  const [seasonInput, setSeasonInput] = useState("");
  const [summary, setSummary] = useState(null);
  const [message, setMessage] = useState("Create or load a season to begin.");
  const [busy, setBusy] = useState(false);
  const [roundNumber, setRoundNumber] = useState(1);
  const [auction, setAuction] = useState(null);
  const [bidPlayerId, setBidPlayerId] = useState("");
  const [bidAmount, setBidAmount] = useState("10");
  const [draft, setDraft] = useState(null);
  const [draftPlayerId, setDraftPlayerId] = useState("");
  const [bootstrap, setBootstrap] = useState(null);
  const refreshShell = async id => { const next = await activation.activate(id); setBootstrap(next); setSummary(next.setup); location.hash = `stage/${next.legalStage}`; if (next.legalStage === "AUCTION_2") { setRoundNumber(2); setAuction(next.phases.auctionTwo); } else if (next.legalStage === "AUCTION_1") { setRoundNumber(1); setAuction(next.phases.auctionOne); } if (next.phases.draft) setDraft(next.phases.draft); return next; };
  const run = async (action, { refresh = true } = {}) => { setBusy(true); setMessage("Saving…"); try { const result = await action(); if (result?.season) setSummary(result); if (refresh && seasonId) await refreshShell(seasonId); setMessage("Saved"); return result; } catch (error) { setMessage(error.message); return undefined; } finally { setBusy(false); } };
  const activateSeason = async id => {
    const nextBootstrap = await activation.activate(id);
    const result = nextBootstrap.setup;
    const state = result.season.state;
    const nextRound = roundTwoViewStates.has(state) ? 2 : 1;
    const auctionRound = roundOneAuctionStates.has(state) ? 1 : roundTwoAuctionStates.has(state) ? 2 : undefined;
    const nextAuction = auctionRound === 1 ? nextBootstrap.phases.auctionOne : auctionRound === 2 ? nextBootstrap.phases.auctionTwo : null;
    const nextDraft = draftStates.has(state) ? nextBootstrap.phases.draft : null;
    setSeasonId(id);
    setSeasonInput(id);
    setRoundNumber(nextRound);
    setAuction(nextAuction);
    setBidPlayerId("");
    setBidAmount("10");
    setDraft(nextDraft);
    setDraftPlayerId("");
    setBootstrap(nextBootstrap);
    return result;
  };
  const loadSeason = id => run(() => activateSeason(id), { refresh: false });
  const refreshAuction = async (round = roundNumber, reveal = false) => { const result = await api(`/api/auction/${seasonId}/${round}${reveal ? "?reveal=true" : ""}`); setRoundNumber(round); setAuction(result); return result; };
  const runAuction = action => run(async () => { const result = await action(); if (result?.teams) setAuction(result); return result; });
  const unresolvedTie = auction?.attempts?.at(-1)?.unresolvedTies?.[0];

  const setupView = <><h2>Teams & catalog</h2><button onClick={() => run(() => api(`/api/setup/${seasonId}/teams`, "PUT", { teams: [{ id: "alpha", displayName: "Alpha", seedOrder: 1 }, { id: "beta", displayName: "Beta", seedOrder: 2 }] }))}>Add teams</button><button onClick={() => run(() => api(`/api/setup/${seasonId}/custom-players`, "POST", { id: `eddie-gallagher-${seasonId}`, name: "Eddie Gallagher", position: "K" }))}>Add Eddie Gallagher</button><CatalogPreparationPanel seasonId={seasonId} request={api} onChanged={() => refreshShell(seasonId)} /><button onClick={() => run(async () => { const content = JSON.stringify([{ externalId: "jj-18", name: "Justin Jefferson", position: "WR" }]); const preview = await api(`/api/setup/${seasonId}/imports/preview`, "POST", { namespace: "sample-nfl", content, format: "json" }); if (preview.errors.length || preview.reviews.length) throw new Error("Import needs review"); await api(`/api/setup/${seasonId}/imports`, "POST", { namespace: "sample-nfl", format: "json", preview }); return api(`/api/setup/${seasonId}`); })}>Import sample NFL players</button><button onClick={() => run(() => api(`/api/setup/${seasonId}/pricing`, "PUT", { floors: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 } }))}>Set $1 floors</button><PricingPreparationPanel seasonId={seasonId} seasonVersion={bootstrap?.season.rowVersion} request={api} onChanged={() => refreshShell(seasonId)} /></>;
  const keepersView = <KeepersPanel seasonId={seasonId} request={api} onChanged={() => refreshShell(seasonId)} onPendingChange={setBusy} />;
  const auctionView = <><h2>Auction round {roundNumber}</h2>{summary && <ul>{summary.teams.map(team => <li key={team.id}>{team.displayName}: ${team.startingBudget}</li>)}</ul>}<p>Team contents remain masked until the round is locked and explicitly revealed.</p><button onClick={() => runAuction(() => api(`/api/auction/${seasonId}/${roundNumber}/open`, "POST"))}>Open round {roundNumber}</button>{auction?.roundNumber === roundNumber && <><PlayerFinder label="Bid player" seasonId={seasonId} request={api} stagePolicy="AUCTION" selectedPlayerId={bidPlayerId} onSelect={player => setBidPlayerId(player.id)} /><label>Amount <input aria-label="Bid amount" type="number" value={bidAmount} onChange={event => setBidAmount(event.target.value)} /></label>{auction.teams.map(team => <span key={team.seasonTeamId}><button disabled={auction.status !== "BIDDING" || !bidPlayerId} onClick={() => runAuction(async () => { await api(`/api/auction/${seasonId}/${roundNumber}/teams/${team.seasonTeamId}`, "PUT", { bids: [{ playerId: bidPlayerId, amount: Number(bidAmount) }], finalize: true }); return refreshAuction(); })}>Finalize bid for {team.displayName}</button><button disabled={auction.status !== "BIDDING"} onClick={() => runAuction(async () => { await api(`/api/auction/${seasonId}/${roundNumber}/teams/${team.seasonTeamId}`, "PUT", { bids: [], finalize: true, confirmZero: true }); return refreshAuction(); })}>Finalize zero bids for {team.displayName}</button></span>)}</>}<button disabled={!auction || auction.status !== "BIDDING"} onClick={() => runAuction(async () => { await api(`/api/auction/${seasonId}/${roundNumber}/lock`, "POST", {}); return refreshAuction(roundNumber, true); })}>Lock, resolve & reveal round {roundNumber}</button>{unresolvedTie && <button onClick={() => runAuction(async () => { await api(`/api/auction/${seasonId}/${roundNumber}/ties`, "POST", { tieKey: unresolvedTie.key, playerId: unresolvedTie.playerId, amount: unresolvedTie.amount, participantTeamIds: unresolvedTie.teamIds, preferredTeamId: unresolvedTie.teamIds[0], method: "commissioner-recorded external draw", decidedAt: new Date().toISOString() }); return refreshAuction(roundNumber, true); })}>Record external tie winner: {unresolvedTie.teamIds[0]}</button>}<button disabled={auction?.status !== "REVIEW"} onClick={() => runAuction(() => api(`/api/auction/${seasonId}/${roundNumber}/publish`, "POST"))}>Publish round {roundNumber}</button></>;
  const orderView = <><h2>Draft Order</h2><button onClick={() => run(async () => { const result = await api(`/api/draft/${seasonId}/order/calculate`, "POST"); setDraft(result); return result; })}>Calculate order from Round 2 balances</button>{draft?.ties?.map(tie => <button key={tie.balance} onClick={() => run(async () => { const result = await api(`/api/draft/${seasonId}/order/ties`, "POST", { balance: tie.balance, participantTeamIds: tie.seasonTeamIds, precedenceTeamIds: [...tie.seasonTeamIds].reverse(), method: "commissioner-recorded external draw", decidedAt: new Date().toISOString() }); setDraft(result); return result; })}>Record external order tie at ${tie.balance}</button>)}<button disabled={!draft || draft.status !== "TIE_PAUSED" || draft.ties.length > 0} onClick={() => run(async () => { const result = await api(`/api/draft/${seasonId}/order/finalize`, "POST"); setDraft(result); return result; })}>Finalize permanent order</button></>;
  const draftView = <><h2>Draft</h2>{draft?.currentSeasonTeamId && <><p>Pick {draft.nextOverallPick}: {draft.order.find(team => team.seasonTeamId === draft.currentSeasonTeamId)?.displayName} is on the clock.</p><PlayerFinder label="Available player" seasonId={seasonId} request={api} stagePolicy="DRAFT" selectedPlayerId={draftPlayerId} onSelect={player => setDraftPlayerId(player.id)} /><button disabled={!draftPlayerId} onClick={() => run(async () => { const result = await api(`/api/draft/${seasonId}/picks`, "POST", { seasonTeamId: draft.currentSeasonTeamId, playerId: draftPlayerId, rosterRules: draftRules }); setDraft(result); setDraftPlayerId(""); return result; })}>Commit legal pick</button></>}</>;
  const views = { SETUP: setupView, KEEPERS: keepersView, AUCTION_1: auctionView, AUCTION_2: auctionView, DRAFT_ORDER: orderView, DRAFT: draftView, RESULTS: <><h2>Results</h2><p>The season is complete.</p><ExportsPanel seasonId={seasonId} seasonVersion={() => client.expectedVersion()} /></> };
  return <main><header><p className="eyebrow">Local commissioner console</p><h1>Draft night</h1><p role="status">{message}</p></header>
    <section><h2>Season</h2><button disabled={busy} onClick={() => run(async () => { const id = crypto.randomUUID(); await api("/api/setup/seasons", "POST", { seasonId: id, leagueId: `local-league-${id}`, year: new Date().getFullYear(), name: "League Draft", teamCount: 2 }); return activateSeason(id); }, { refresh: false })}>Create two-team season</button><label>Existing season ID <input aria-label="Existing season ID" value={seasonInput} onChange={event => setSeasonInput(event.target.value)} /></label><button disabled={!seasonInput || busy} onClick={() => loadSeason(seasonInput)}>Load season</button></section>
    {bootstrap && <StageShell bootstrap={bootstrap}>{(access, policy) => <fieldset disabled={busy || !policy.mutationsEnabled}>{views[access.stage]}</fieldset>}</StageShell>}
    <div id="operations"><OperationsPanel seasonId={seasonId || undefined} seasonVersion={() => client.expectedVersion()} onChanged={() => { if (seasonId) loadSeason(seasonId); }} /></div>
  </main>;
}
createRoot(document.getElementById("root")).render(<SetupApp />);
