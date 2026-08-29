import React, { useEffect, useMemo, useRef, useState } from "react";
import { PlayerFinder } from "../../shared/player-finder.jsx";

const sourceLabel = player => player.sourceType === "LEAGUE_CUSTOM" ? "League custom" : "NFL catalog";
const availabilityLabel = reason => ({
  AVAILABLE: "Available",
  OWNED: "Already rostered",
  LEAGUE_DISABLED: "Not selectable in this league",
  CATALOG_INACTIVE: "Inactive in the current catalog",
}[reason] ?? reason);

function PlayerContext({ player }) {
  if (!player) return <p>No keeper selected. Round 1 budget: $350.</p>;
  return <p><strong>{player.name}</strong> · {player.position}{player.nflTeam ? ` · ${player.nflTeam}` : " · Free agent"} · {sourceLabel(player)} · {player.minimumBid === undefined ? "Missing price" : `$${player.minimumBid} minimum`} · {player.priceSourceLabel} · {player.valid ? "Eligible" : availabilityLabel(player.availabilityReason)}</p>;
}

export function KeepersPanel({ seasonId, request, onChanged, onPendingChange = () => {}, initialSummary = null }) {
  const [summary, setSummary] = useState(initialSummary);
  const [activeTeamId, setActiveTeamId] = useState(initialSummary?.teams[0]?.seasonTeamId ?? "");
  const [keeperCandidate, setKeeperCandidate] = useState(null);
  const [eligibilityCandidate, setEligibilityCandidate] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const requestSequence = useRef(0);
  const activeTeam = useMemo(() => summary?.teams.find(team => team.seasonTeamId === activeTeamId) ?? summary?.teams[0], [summary, activeTeamId]);

  const load = async () => {
    const sequence = ++requestSequence.current;
    const next = await request(`/api/setup/${seasonId}/keepers`);
    if (sequence !== requestSequence.current || next.season.id !== seasonId) return null;
    setSummary(next);
    setActiveTeamId(current => next.teams.some(team => team.seasonTeamId === current) ? current : (next.teams[0]?.seasonTeamId ?? ""));
    return next;
  };
  useEffect(() => {
    requestSequence.current += 1;
    setKeeperCandidate(null);
    setEligibilityCandidate(null);
    setConfirmed(false);
    if (initialSummary?.season.id === seasonId) {
      setSummary(initialSummary);
      setActiveTeamId(initialSummary.teams[0]?.seasonTeamId ?? "");
    } else {
      setSummary(null);
      void load().catch(error => setStatus(error.message));
    }
    return () => { requestSequence.current += 1; };
  }, [seasonId, initialSummary, request]);

  const mutate = async action => {
    const mutationSeasonId = seasonId;
    const sequence = ++requestSequence.current;
    setPending(true);
    onPendingChange(true);
    setStatus("Saving keeper review.");
    try {
      await action();
      if (sequence !== requestSequence.current || mutationSeasonId !== seasonId) return;
      setStatus("Keeper review saved. Refreshing.");
      try {
        await load();
      } catch (error) {
        if (mutationSeasonId === seasonId) setStatus(`Keeper review saved; refresh failed: ${error.message}`);
        return;
      }
      setConfirmed(false);
      setStatus("Keeper review saved.");
    } catch (error) {
      if (sequence === requestSequence.current && mutationSeasonId === seasonId) setStatus(error.message);
    } finally {
      if (mutationSeasonId === seasonId) {
        setPending(false);
        onPendingChange(false);
      }
    }
  };
  const eligibleIds = summary?.eligiblePlayers.map(player => player.id) ?? [];

  if (!summary) return <section aria-label="Keepers"><h2>Keepers</h2><p role="status">{status || "Loading keeper review."}</p></section>;
  return <section aria-label="Keepers">
    <h2>Keepers</h2>
    {summary.locked && <p>Keepers are locked. Use the Operations correction link to change keeper history.</p>}
    <p>Review one team at a time. A keeper costs $50 and reduces its Round 1 budget from $350 to $300.</p>
    <div className="keeper-team-tabs" role="group" aria-label="Keeper team">
      {summary.teams.map(team => <button key={team.seasonTeamId} type="button" disabled={pending} aria-pressed={activeTeam?.seasonTeamId === team.seasonTeamId} onClick={() => { setActiveTeamId(team.seasonTeamId); setKeeperCandidate(null); }}>{team.displayName}</button>)}
    </div>
    {activeTeam && <section aria-label={`${activeTeam.displayName} keeper`}>
      <h3>{activeTeam.displayName}</h3>
      <PlayerContext player={activeTeam.selectedPlayer} />
      <p>{activeTeam.keeperCost ? "$50 keeper cost" : "$0 keeper cost"}; ${activeTeam.startingBudget} Round 1 budget.</p>
      {!summary.locked && <><PlayerFinder key={summary.season.rowVersion} label="Keeper player" seasonId={seasonId} request={request} stagePolicy="KEEPER" selectedPlayerId={keeperCandidate?.id ?? activeTeam.selectedPlayer?.id} onSelect={setKeeperCandidate} />
      <button type="button" disabled={pending || !keeperCandidate} onClick={() => mutate(async () => { await request(`/api/setup/${seasonId}/teams/${activeTeam.seasonTeamId}/keeper`, "PUT", { playerId: keeperCandidate.id }); setKeeperCandidate(null); })}>Save keeper for {activeTeam.displayName}</button>
      <button type="button" disabled={pending || !activeTeam.selectedPlayer} onClick={() => mutate(() => request(`/api/setup/${seasonId}/teams/${activeTeam.seasonTeamId}/keeper`, "PUT", {}))}>Clear keeper for {activeTeam.displayName}</button></>}
    </section>}

    {!summary.locked && <details>
      <summary>Manage keeper eligibility</summary>
      <PlayerFinder label="Eligibility player" seasonId={seasonId} request={request} stagePolicy="SETUP" selectedPlayerId={eligibilityCandidate?.id} onSelect={setEligibilityCandidate} />
      <button type="button" disabled={pending || !eligibilityCandidate || eligibleIds.includes(eligibilityCandidate.id)} onClick={() => mutate(async () => { await request(`/api/setup/${seasonId}/keeper-eligibility`, "PUT", { playerIds: [...eligibleIds, eligibilityCandidate.id] }); setEligibilityCandidate(null); })}>Add keeper eligibility</button>
      <ul>{summary.eligiblePlayers.map(player => <li key={player.id}>{player.name} ({player.position}) · {sourceLabel(player)} <button type="button" disabled={pending} onClick={() => mutate(() => request(`/api/setup/${seasonId}/keeper-eligibility`, "PUT", { playerIds: eligibleIds.filter(id => id !== player.id) }))}>Remove {player.name} eligibility</button></li>)}</ul>
    </details>}

    <section aria-label="Final lock review">
      <h3>Final lock review</h3>
      <ul>{summary.teams.map(team => <li key={team.seasonTeamId}><strong>{team.displayName}</strong>: {team.selectedPlayer ? `${team.selectedPlayer.name} (${sourceLabel(team.selectedPlayer)}) · $50 cost · $300 budget${team.selectedPlayer.valid ? "" : ` · ${availabilityLabel(team.selectedPlayer.availabilityReason)}`}` : "No keeper · $350 budget"}</li>)}</ul>
      {summary.preflight.missingTeamCount > 0 && <p>{summary.preflight.missingTeamCount} team(s) are missing from setup.</p>}
      {summary.preflight.invalidSelectionCount > 0 && <p>{summary.preflight.invalidSelectionCount} keeper selection(s) must be changed or cleared.</p>}
      {summary.preflight.missingPriceCount > 0 && <p>{summary.preflight.missingPriceCount} player price(s) remain unresolved.</p>}
      {summary.preflight.unresolvedPriceReviewCount > 0 && <p>{summary.preflight.unresolvedPriceReviewCount} price-list review(s) remain unresolved.</p>}
      {!summary.locked && <><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I reviewed every team and confirm keeper lock</label>
      <button type="button" disabled={pending || !confirmed || !summary.preflight.canLock} onClick={() => mutate(async () => { await request(`/api/setup/${seasonId}/lock`, "POST", { rosterCapacity: 14 }); await onChanged(); })}>Lock reviewed keepers</button></>}
      {summary.locked && <p><a href="#operations">Preview a correction in Operations</a>.</p>}
    </section>
    <p aria-live="polite">{status}</p>
  </section>;
}
