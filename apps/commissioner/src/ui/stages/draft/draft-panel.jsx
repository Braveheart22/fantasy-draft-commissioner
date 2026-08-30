import React, { useEffect, useMemo, useRef, useState } from "react";
import { PlayerFinder } from "../../shared/player-finder.jsx";

const draftRules = { limits: { QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 }, flexEligible: ["RB", "WR", "TE"], flexCapacity: 1 };

export function DraftPanel({ seasonId, request, initialSummary, onChanged = () => {}, onPendingChange = () => {} }) {
  const [summary, setSummary] = useState(initialSummary);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [otherTeamId, setOtherTeamId] = useState(initialSummary?.teams?.find(team => team.seasonTeamId !== initialSummary.currentSeasonTeamId)?.seasonTeamId ?? "");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(() => { sequence.current += 1; setSummary(initialSummary); setSelectedPlayer(null); setStatus(""); }, [seasonId, initialSummary]);
  const currentTeam = useMemo(() => summary?.teams?.find(team => team.seasonTeamId === summary.currentSeasonTeamId), [summary]);
  const otherTeam = summary?.teams?.find(team => team.seasonTeamId === otherTeamId) ?? summary?.teams?.find(team => team.seasonTeamId !== summary?.currentSeasonTeamId);
  const commit = async () => {
    if (!selectedPlayer || !summary?.currentSeasonTeamId) return;
    const current = ++sequence.current; setBusy(true); onPendingChange(true); setStatus("Committing pick.");
    try { const next = await request(`/api/draft/${seasonId}/picks`, "POST", { seasonTeamId: summary.currentSeasonTeamId, playerId: selectedPlayer.id, rosterRules: draftRules }); if (current !== sequence.current) return; setSummary(next); setSelectedPlayer(null); setStatus(`${selectedPlayer.name} committed. Next team is on the clock.`); await onChanged(next); }
    catch (error) { if (current === sequence.current) setStatus(error.message); }
    finally { setBusy(false); onPendingChange(false); }
  };
  if (!summary) return <section><h2>Draft</h2><p>Finalize the draft order to begin.</p></section>;
  return <section className="draft-control-room" aria-label="Conventional draft control room">
    <header className="draft-clock"><p>Round {summary.currentRound ?? 1} · Overall pick {summary.nextOverallPick}</p><h2>{currentTeam ? `${currentTeam.displayName} is on the clock` : "Conventional draft complete"}</h2><p>{summary.filledRosterSlots ?? 0} of {summary.totalRosterSlots ?? 0} roster slots filled</p><button type="button" disabled={busy || !selectedPlayer || !currentTeam} onClick={commit}>Commit legal pick{selectedPlayer ? `: ${selectedPlayer.name}` : ""}</button><p aria-live="polite">{status}</p></header>
    <div className="draft-panes"><section className="draft-available"><h3>Available players</h3><PlayerFinder label="Available player" seasonId={seasonId} request={request} stagePolicy="DRAFT" selectedPlayerId={selectedPlayer?.id} onSelect={setSelectedPlayer} /></section>
      <section className="draft-current"><h3>{currentTeam?.displayName ?? "Current"} roster</h3>{selectedPlayer && <p>Selected: {selectedPlayer.name} · {selectedPlayer.position}</p>}<p>Open slots: {currentTeam?.openSlots ?? 0}</p><p>Legal next positions: {currentTeam?.legalNextPositions?.join(", ") || "None"}</p><Roster team={currentTeam} /></section>
      <aside className="draft-context"><h3>Other rosters</h3><div role="tablist" aria-label="Other team rosters">{summary.teams?.filter(team => team.seasonTeamId !== summary.currentSeasonTeamId).map(team => <button type="button" role="tab" key={team.seasonTeamId} aria-selected={team.seasonTeamId === otherTeam?.seasonTeamId} onClick={() => setOtherTeamId(team.seasonTeamId)}>{team.displayName} roster</button>)}</div><Roster team={otherTeam} /><h3>Recent history</h3><ol>{summary.history?.map(item => <li key={item.overallPick}>Pick {item.overallPick} · {item.playerName} · {item.position} · {item.displayName}</li>)}</ol></aside>
    </div></section>;
}

function Roster({ team }) { return <ul>{team?.roster?.length ? team.roster.map(player => <li key={player.playerId}>{player.playerName} · {player.position} · {sourceLabel(player.acquisitionSource)}</li>) : <li>Roster is empty.</li>}</ul>; }
function sourceLabel(source) { return source === "CONVENTIONAL" ? "Draft" : source === "AUCTION" ? "Auction" : source === "KEEPER" ? "Keeper" : source; }
