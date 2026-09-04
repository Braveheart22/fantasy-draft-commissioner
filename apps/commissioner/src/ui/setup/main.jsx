import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./setup.css";
import { OperationsPanel } from "../operations/operations-panel.jsx";
import { LifecycleState } from "../../application/ports/season-repository.js";
import { createApiClient, createSeasonActivation } from "../shared/api-client.js";
import { StageShell } from "../app/stage-shell.jsx";
import { CatalogPreparationPanel } from "../stages/setup/catalog-preparation-panel.jsx";
import { PricingPreparationPanel } from "../stages/setup/pricing-preparation-panel.jsx";
import { KeepersPanel } from "../stages/keepers/keepers-panel.jsx";
import { AuctionPanel } from "../stages/auction/auction-panel.jsx";
import { DraftOrderPanel } from "../stages/draft-order/draft-order-panel.jsx";
import { DraftPanel } from "../stages/draft/draft-panel.jsx";
import { ResultsPanel } from "../stages/results/results-panel.jsx";

const client = createApiClient();
const activation = createSeasonActivation(client);
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
  const [draft, setDraft] = useState(null);
  const [bootstrap, setBootstrap] = useState(null);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [seasonForm,setSeasonForm]=useState({name:"",year:String(new Date().getFullYear()),teamCount:""});
  const [teamNames,setTeamNames]=useState(""); const [customPlayer,setCustomPlayer]=useState({name:"",position:"QB"}); const [floorAmount,setFloorAmount]=useState("");
  useEffect(() => { const open = () => setOperationsOpen(true); addEventListener("open-operations", open); return () => removeEventListener("open-operations", open); }, []);
  const refreshShell = async id => { const next = await activation.activate(id); if(!next)return activation.current(); setBootstrap(next); setSummary(next.setup); if (next.legalStage === "AUCTION_2") { setRoundNumber(2); setAuction(next.phases.auctionTwo); } else if (next.legalStage === "AUCTION_1") { setRoundNumber(1); setAuction(next.phases.auctionOne); } if (next.phases.draft) setDraft(next.phases.draft); return next; };
  const run = async (action, { refresh = true } = {}) => { setBusy(true); setMessage("Saving…"); try { const result = await action(); if (result?.season) setSummary(result); if (refresh && seasonId) await refreshShell(seasonId); setMessage("Saved"); return result; } catch (error) { setMessage(error.message); return undefined; } finally { setBusy(false); } };
  const activateSeason = async id => {
    const nextBootstrap = await activation.activate(id);
    if (!nextBootstrap) return null;
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
    setDraft(nextDraft);
    setBootstrap(nextBootstrap);
    return result;
  };
  const loadSeason = id => run(() => activateSeason(id), { refresh: false });
  const resumeAfterOperation = async () => { if (!seasonId) return; setBusy(true); setMessage("Reloading corrected season…"); try { await activateSeason(seasonId); setMessage("Correction saved"); setOperationsOpen(false); } catch (error) { setMessage(error.message); throw error; } finally { setBusy(false); } };

  const setupView = <><h2>Teams & catalog</h2><label>Team names, one per line<textarea value={teamNames} onChange={event=>setTeamNames(event.target.value)}/></label><button disabled={!teamNames.trim()} onClick={()=>run(()=>{const names=teamNames.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);return api(`/api/setup/${seasonId}/teams`,"PUT",{teams:names.map((displayName,index)=>({id:`team-${index+1}`,displayName,seedOrder:index+1}))});})}>Save teams</button><label>Custom player name<input value={customPlayer.name} onChange={event=>setCustomPlayer({...customPlayer,name:event.target.value})}/></label><label>Custom player position<select value={customPlayer.position} onChange={event=>setCustomPlayer({...customPlayer,position:event.target.value})}>{["QB","RB","WR","TE","K","DST"].map(value=><option key={value}>{value}</option>)}</select></label><button disabled={!customPlayer.name.trim()} onClick={()=>run(()=>api(`/api/setup/${seasonId}/custom-players`,"POST",{id:crypto.randomUUID(),name:customPlayer.name.trim(),position:customPlayer.position}))}>Add custom player</button><CatalogPreparationPanel seasonId={seasonId} request={api} onChanged={() => refreshShell(seasonId)} /><label>Default positional floor<input type="number" min="1" step="1" value={floorAmount} onChange={event=>setFloorAmount(event.target.value)}/></label><button disabled={!Number.isInteger(Number(floorAmount))||Number(floorAmount)<1} onClick={()=>run(()=>api(`/api/setup/${seasonId}/pricing`,"PUT",{floors:Object.fromEntries(["QB","RB","WR","TE","K","DST"].map(position=>[position,Number(floorAmount)]))}))}>Save positional floors</button><PricingPreparationPanel seasonId={seasonId} seasonVersion={bootstrap?.season.rowVersion} request={api} onChanged={() => refreshShell(seasonId)} /></>;
  const keepersView = <KeepersPanel seasonId={seasonId} request={api} onChanged={() => refreshShell(seasonId)} onPendingChange={setBusy} />;
  const auctionView = <AuctionPanel seasonId={seasonId} roundNumber={roundNumber} request={api} onChanged={() => refreshShell(seasonId)} onPendingChange={setBusy} initialSummary={auction?.roundNumber === roundNumber ? auction : null} />;
  const orderView = <DraftOrderPanel seasonId={seasonId} request={api} initialSummary={draft} onChanged={next => { if (next) setDraft(next); return refreshShell(seasonId); }} onPendingChange={setBusy} />;
  const draftView = <DraftPanel seasonId={seasonId} request={api} initialSummary={draft} onChanged={next => { if (next) setDraft(next); return refreshShell(seasonId); }} onPendingChange={setBusy} />;
  const views = { SETUP: setupView, KEEPERS: keepersView, AUCTION_1: auctionView, AUCTION_2: auctionView, DRAFT_ORDER: orderView, DRAFT: draftView, RESULTS: <ResultsPanel seasonId={seasonId} request={api} seasonVersion={() => client.expectedVersion()} /> };
  return <main><header><p className="eyebrow">Local commissioner console</p><h1>Draft night</h1><p role="status">{message}</p></header>
    <section><h2>Season</h2><label>Season name<input value={seasonForm.name} onChange={event=>setSeasonForm({...seasonForm,name:event.target.value})}/></label><label>Season year<input type="number" min="1" value={seasonForm.year} onChange={event=>setSeasonForm({...seasonForm,year:event.target.value})}/></label><label>Team count<input type="number" min="1" value={seasonForm.teamCount} onChange={event=>setSeasonForm({...seasonForm,teamCount:event.target.value})}/></label><button disabled={busy||!seasonForm.name.trim()||!Number.isInteger(Number(seasonForm.year))||Number(seasonForm.year)<1||!Number.isInteger(Number(seasonForm.teamCount))||Number(seasonForm.teamCount)<1} onClick={() => run(async () => { const id = crypto.randomUUID(); await api("/api/setup/seasons", "POST", { seasonId: id, leagueId: `local-league-${id}`, year:Number(seasonForm.year), name:seasonForm.name.trim(), teamCount:Number(seasonForm.teamCount) }); return activateSeason(id); }, { refresh: false })}>Create season</button><label>Existing season ID <input aria-label="Existing season ID" value={seasonInput} onChange={event => setSeasonInput(event.target.value)} /></label><button disabled={!seasonInput || busy} onClick={() => loadSeason(seasonInput)}>Load season</button></section>
    <nav aria-label="Workspace"><button type="button" aria-pressed={!operationsOpen} onClick={()=>setOperationsOpen(false)}>Draft night</button><button type="button" aria-pressed={operationsOpen} onClick={()=>setOperationsOpen(true)}>Operations</button></nav>
    {operationsOpen?<OperationsPanel seasonId={seasonId || undefined} seasonVersion={() => client.expectedVersion()} onChanged={resumeAfterOperation} />:bootstrap && <StageShell bootstrap={bootstrap}>{(access, policy) => <fieldset disabled={busy || !policy.mutationsEnabled}>{views[access.stage]}</fieldset>}</StageShell>}
  </main>;
}
createRoot(document.getElementById("root")).render(<SetupApp />);
