import React, { useEffect, useMemo, useRef, useState } from "react";
import { PlayerFinder } from "../../shared/player-finder.jsx";
import { useStageMutationGuard } from "../../shared/stage-mutation-guard.jsx";

const draftRules = { limits: { QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 }, flexEligible: ["RB", "WR", "TE"], flexCapacity: 1 };

export function DraftPanel({ seasonId, request, initialSummary, onChanged = () => {}, onPendingChange = () => {} }) {
  const [summary, setSummary] = useState(initialSummary);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [otherTeamId, setOtherTeamId] = useState(initialSummary?.teams?.find(team => team.seasonTeamId !== initialSummary.currentSeasonTeamId)?.seasonTeamId ?? "");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  useStageMutationGuard("DRAFT", busy || refreshRequired);
  const [contextTab, setContextTab] = useState("rosters");
  const sequence = useRef(0);
  const room = useRef(null);
  useEffect(() => { room.current?.scrollIntoView({block:"start"}); return () => { sequence.current++; }; }, [seasonId]);
  useEffect(() => { sequence.current += 1; setSummary(initialSummary); setSelectedPlayer(null); setStatus(""); setRefreshRequired(false); }, [seasonId, initialSummary]);
  const currentTeam = useMemo(() => summary?.teams?.find(team => team.seasonTeamId === summary.currentSeasonTeamId), [summary]);
  const otherTeam = summary?.teams?.find(team => team.seasonTeamId === otherTeamId && team.seasonTeamId !== summary.currentSeasonTeamId) ?? summary?.teams?.find(team => team.seasonTeamId !== summary?.currentSeasonTeamId);
  const commit = async () => {
    if (busy || !selectedPlayer || !summary?.currentSeasonTeamId || refreshRequired) return;
    const current = ++sequence.current; setBusy(true); onPendingChange(true); setStatus("Committing pick.");
    try { const next = await request(`/api/draft/${seasonId}/picks`, "POST", { seasonTeamId: summary.currentSeasonTeamId, playerId: selectedPlayer.id, rosterRules: draftRules }); if (current !== sequence.current) return; setSummary(next); setSelectedPlayer(null); setStatus(`${selectedPlayer.name} committed. Next team is on the clock.`); try { await onChanged(next); } catch { setRefreshRequired(true); setStatus("Pick saved, but the season refresh failed. Reload draft state before continuing."); } }
    catch (error) { if (current === sequence.current) { if(error.code==="ACKNOWLEDGED_REFRESH_FAILED"){setSummary(error.acknowledgedResult);setSelectedPlayer(null);setRefreshRequired(true);} setStatus(error.message); } }
    finally { setBusy(false); onPendingChange(false); }
  };
  if (!summary) return <section><h2>Draft</h2><p>Finalize the draft order to begin.</p></section>;
  return <section ref={room} className="draft-control-room" aria-label="Conventional draft control room">
    <header className="draft-clock"><p>Round {summary.currentRound ?? 1} · Overall pick {summary.nextOverallPick}</p><h2>{currentTeam ? `${currentTeam.displayName} is on the clock` : "Conventional draft complete"}</h2><p>{summary.filledRosterSlots ?? 0} of {summary.totalRosterSlots ?? 0} roster slots filled</p><button type="button" disabled={busy || refreshRequired || !selectedPlayer || !currentTeam} onClick={commit}>Commit legal pick{selectedPlayer ? `: ${selectedPlayer.name}` : ""}</button>{refreshRequired && <button type="button" disabled={busy} onClick={async()=>{setBusy(true);onPendingChange(true);try{await onChanged();}catch(error){setStatus(error.message);}finally{setBusy(false);onPendingChange(false);}}}>Reload draft state</button>}<p aria-live="polite">{status}</p></header>
    <div className="draft-panes"><section className="draft-available"><h3>Available players</h3><PlayerFinder label="Available player" seasonId={seasonId} request={request} stagePolicy="DRAFT" selectedPlayerId={selectedPlayer?.id} onSelect={setSelectedPlayer} refreshToken={summary.nextOverallPick} /></section>
      <section className="draft-current"><h3>{currentTeam?.displayName ?? "Current"} roster</h3>{selectedPlayer && <p>Selected: {selectedPlayer.name} · {selectedPlayer.position}</p>}<p>Open slots: {currentTeam?.openSlots ?? 0}</p><p>Legal next positions: {currentTeam?.legalNextPositions?.join(", ") || "None"}</p><Roster team={currentTeam} /></section>
      <aside className="draft-context"><h3>Fixed draft order</h3><ol>{summary.order?.map(team=><li key={team.seasonTeamId} aria-current={team.seasonTeamId===summary.currentSeasonTeamId?"step":undefined}>{team.displayName}</li>)}</ol><div className="draft-context-tabs" role="tablist" aria-label="Draft context">{["rosters","history"].map(tab=><button key={tab} type="button" role="tab" aria-selected={contextTab===tab} onClick={()=>setContextTab(tab)}>{tab==="rosters"?"Other rosters":"Recent history"}</button>)}</div><section className={`draft-context-content ${contextTab==="rosters"?"active":""}`}><h3>Other rosters</h3><div role="tablist" aria-label="Other team rosters">{summary.teams?.filter(team => team.seasonTeamId !== summary.currentSeasonTeamId).map(team => <button type="button" role="tab" key={team.seasonTeamId} aria-selected={team.seasonTeamId === otherTeam?.seasonTeamId} onClick={() => setOtherTeamId(team.seasonTeamId)}>{team.displayName} roster</button>)}</div><Roster team={otherTeam} /></section><section className={`draft-context-content ${contextTab==="history"?"active":""}`}><h3>Recent history</h3><ol>{summary.history?.map(item => <li key={item.overallPick}>Pick {item.overallPick} · {item.playerName} · {item.position} · {item.displayName}</li>)}</ol></section></aside>
    </div></section>;
}

function Roster({ team }) { return <div aria-label={`${team?.displayName ?? "Current"} roster details`}>{team?.roster?.length ? ["QB","RB","WR","TE","K","DST"].map(position=>{const players=team.roster.filter(player=>player.position===position);return players.length?<section key={position}><h4>{position} ({players.length})</h4><ul>{players.map(player=><li key={player.playerId}>{player.playerName} · {player.position} · {sourceLabel(player.acquisitionSource)}</li>)}</ul></section>:null;}) : <p>Roster is empty.</p>}</div>; }
function sourceLabel(source) { return source === "CONVENTIONAL" ? "Draft" : source === "AUCTION" ? "Auction" : source === "KEEPER" ? "Keeper" : source; }
