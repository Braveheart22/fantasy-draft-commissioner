import React, { useEffect, useMemo, useRef, useState } from "react";
import { PlayerFinder } from "../../shared/player-finder.jsx";

const emptyRows = () => Array.from({ length: 3 }, () => ({ player: null, amount: "" }));
const rowsFromSubmission = submission => {
  const rows = emptyRows();
  for (const bid of submission?.bids ?? []) rows[bid.priority - 1] = { player: { id: bid.playerId, name: bid.playerName, position: bid.position, minimumBid: bid.minimumBid }, amount: String(bid.amount) };
  return rows;
};

export function AuctionPanel({ seasonId, roundNumber, request, onChanged, onPendingChange = () => {}, initialSummary, initialSubmission = null }) {
  const [summary, setSummary] = useState(initialSummary);
  const [activeTeamId, setActiveTeamId] = useState(initialSubmission?.seasonTeamId ?? initialSummary?.teams[0]?.seasonTeamId ?? "");
  const [submission, setSubmission] = useState(initialSubmission);
  const [rows, setRows] = useState(() => rowsFromSubmission(initialSubmission));
  const [dirty, setDirty] = useState(false);
  const [pendingTeamId, setPendingTeamId] = useState("");
  const [pendingStageHref, setPendingStageHref] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const scopeKey = useRef(`${seasonId}:${roundNumber}`);
  const activeTeam = useMemo(() => summary?.teams.find(team => team.seasonTeamId === activeTeamId), [summary, activeTeamId]);
  const balance = summary?.balances.find(item => item.seasonTeamId === activeTeamId);

  const loadTeam = async teamId => {
    const current = ++sequence.current;
    setSubmission(null);
    setRows(emptyRows());
    setActiveTeamId(teamId);
    setStatus("Loading private saved draft.");
    let next;
    try { next = await request(`/api/auction/${seasonId}/${roundNumber}/teams/${teamId}/submission`); }
    catch (error) { if (current === sequence.current) setStatus(error.message); return false; }
    if (current !== sequence.current) return;
    setSubmission(next);
    setRows(rowsFromSubmission(next));
    setDirty(false);
    setStatus(`${next.bidCount} saved bid${next.bidCount === 1 ? "" : "s"}; ${next.status.toLowerCase()}.`);
    return true;
  };
  useEffect(() => {
    const nextScopeKey = `${seasonId}:${roundNumber}`;
    const sameScope = scopeKey.current === nextScopeKey;
    scopeKey.current = nextScopeKey;
    setSummary(initialSummary);
    if (sameScope && dirty) {
      setStatus("Server state refreshed; unsaved bid changes are still being edited.");
      return;
    }
    sequence.current += 1;
    setPendingTeamId("");
    setDirty(false);
    if (initialSummary?.status === "BIDDING") {
      const teamId = initialSummary.teams.some(team => team.seasonTeamId === activeTeamId) ? activeTeamId : initialSummary.teams[0]?.seasonTeamId;
      if (teamId) void loadTeam(teamId);
    } else {
      setSubmission(null);
      setRows(emptyRows());
    }
    return () => { sequence.current += 1; };
  }, [seasonId, roundNumber, initialSummary]);
  useEffect(() => {
    const guard = event => {
      if (!dirty) return;
      event.preventDefault();
      setPendingStageHref(event.detail.href);
    };
    addEventListener("stage-navigation-request", guard);
    return () => removeEventListener("stage-navigation-request", guard);
  }, [dirty]);

  const run = async (label, action) => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true); onPendingChange(true); setStatus(label);
    try { return await action(); }
    catch (error) { setStatus(error.message); }
    finally { inFlight.current = false; setBusy(false); onPendingChange(false); }
  };
  const bids = rows.filter(row => row.player).map(row => ({ playerId: row.player.id, amount: Number(row.amount) }));
  const save = async () => run("Saving private draft.", async () => {
    const next = await request(`/api/auction/${seasonId}/${roundNumber}/teams/${activeTeamId}`, "PUT", { bids });
    setSummary(next); setDirty(false); await loadTeam(activeTeamId); setStatus("Draft saved."); return true;
  });
  const chooseTeam = teamId => { if (teamId === activeTeamId) return; if (dirty) setPendingTeamId(teamId); else void loadTeam(teamId); };
  const setRow = (index, patch) => { setRows(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row)); setDirty(true); };
  const move = (index, offset) => { const target = index + offset; if (target < 0 || target > 2) return; setRows(current => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; }); setDirty(true); };

  if (!summary) return <section aria-label={`Auction round ${roundNumber}`}><h2>Auction round {roundNumber}</h2><p>Round {roundNumber} has not been opened.</p><button type="button" disabled={busy} onClick={() => run(`Opening round ${roundNumber}.`, async () => { await request(`/api/auction/${seasonId}/${roundNumber}/open`, "POST"); await onChanged(); })}>Open round {roundNumber}</button><p aria-live="polite">{status}</p></section>;
  const unresolvedTie = summary.attempts.at(-1)?.unresolvedTies?.[0];
  return <section aria-label={`Auction round ${roundNumber}`}>
    <h2>Auction round {roundNumber}</h2>
    <p>Saved team bids stay private until the round is locked and revealed.</p>
    <div role="group" aria-label="Auction team">{summary.teams.map(team => <button key={team.seasonTeamId} type="button" disabled={busy} aria-pressed={team.seasonTeamId === activeTeamId} onClick={() => chooseTeam(team.seasonTeamId)}>{team.displayName} · {team.status} · {team.bidCount} bid(s)</button>)}</div>
    {(pendingTeamId || pendingStageHref) && <section role="dialog" aria-label="Unsaved bid changes"><p>Save or discard this team’s unsaved bid changes before navigating.</p><button type="button" disabled={busy} onClick={async () => { if (!await save()) return; const targetTeam = pendingTeamId; const targetStage = pendingStageHref; setPendingTeamId(""); setPendingStageHref(""); if (targetTeam) await loadTeam(targetTeam); else if (targetStage) location.hash = targetStage; }}>Save draft and continue</button><button type="button" disabled={busy} onClick={() => { const targetTeam = pendingTeamId; const targetStage = pendingStageHref; setPendingTeamId(""); setPendingStageHref(""); setDirty(false); if (targetTeam) void loadTeam(targetTeam); else if (targetStage) location.hash = targetStage; }}>Discard changes and continue</button><button type="button" disabled={busy} onClick={() => { setPendingTeamId(""); setPendingStageHref(""); }}>Keep editing</button></section>}
    {summary.status === "BIDDING" && activeTeam && <section aria-label={`${activeTeam.displayName} bid entry`}><h3>{activeTeam.displayName} bid entry</h3><p>{balance ? `$${balance.startingBudget} starting budget` : "Budget unavailable"} · {submission?.status ?? activeTeam.status}</p>
      {rows.map((row, index) => <section key={index} aria-label={`Priority ${index + 1} bid`}><h4>Priority {index + 1}</h4><PlayerFinder label={`Priority ${index + 1} player`} seasonId={seasonId} request={request} stagePolicy="AUCTION" selectedPlayerId={row.player?.id} onSelect={player => setRow(index, { player })} /><p>{row.player ? `${row.player.name} · ${row.player.position} · ${row.player.minimumBid === undefined ? "No minimum" : `$${row.player.minimumBid} minimum`}` : "No player selected"}</p><label>Priority {index + 1} amount <input type="number" min="1" value={row.amount} onChange={event => setRow(index, { amount: event.target.value })} /></label><button type="button" disabled={index === 0} onClick={() => move(index, -1)}>Move priority {index + 1} up</button><button type="button" disabled={index === 2} onClick={() => move(index, 1)}>Move priority {index + 1} down</button><button type="button" disabled={!row.player} onClick={() => setRow(index, { player: null, amount: "" })}>Clear priority {index + 1}</button></section>)}
      <button type="button" disabled={busy || !dirty || bids.some(bid => !Number.isSafeInteger(bid.amount) || bid.amount < 1)} onClick={save}>Save draft</button>
      <button type="button" disabled={busy || submission?.status !== "DRAFT" || !submission?.bidCount} onClick={() => run(dirty ? "Finalizing the last saved draft; unsaved edits will be discarded." : "Finalizing saved draft.", async () => { const next = await request(`/api/auction/${seasonId}/${roundNumber}/teams/${activeTeamId}/finalize`, "POST", {}); setSummary(next); await loadTeam(activeTeamId); })}>Finalize saved draft</button>
      <button type="button" disabled={busy || dirty || submission?.status !== "DRAFT" || submission?.bidCount !== 0} onClick={() => run("Confirming zero bids.", async () => { const next = await request(`/api/auction/${seasonId}/${roundNumber}/teams/${activeTeamId}/finalize`, "POST", { confirmZero: true }); setSummary(next); await loadTeam(activeTeamId); })}>Finalize zero bids</button>
    </section>}
    {summary.revealed && <section aria-label="Revealed auction submissions"><h3>Revealed submissions</h3>{summary.teams.map(team => <section key={team.seasonTeamId}><h4>{team.displayName}</h4>{team.bids?.length ? <ol>{team.bids.map(bid => <li key={bid.bidId}>Priority {bid.priority}: {bid.playerName ?? "Unknown player"} · ${bid.amount}</li>)}</ol> : <p>Zero bids</p>}</section>)}</section>}
    <button type="button" disabled={busy || dirty || summary.status !== "BIDDING" || summary.teams.some(team => team.status !== "FINAL")} onClick={() => run("Locking and resolving round.", async () => { await request(`/api/auction/${seasonId}/${roundNumber}/lock`, "POST", {}); await onChanged(); })}>Lock, resolve & reveal round {roundNumber}</button>
    {unresolvedTie && <button type="button" disabled={busy} onClick={() => run("Recording external tie decision.", async () => { await request(`/api/auction/${seasonId}/${roundNumber}/ties`, "POST", { tieKey: unresolvedTie.key, playerId: unresolvedTie.playerId, amount: unresolvedTie.amount, participantTeamIds: unresolvedTie.teamIds, preferredTeamId: unresolvedTie.teamIds[0], method: "commissioner-recorded external draw", decidedAt: new Date().toISOString() }); await onChanged(); })}>Record external tie winner: {unresolvedTie.teamIds[0]}</button>}
    <button type="button" disabled={busy || summary.status !== "REVIEW"} onClick={() => run(`Publishing round ${roundNumber}.`, async () => { await request(`/api/auction/${seasonId}/${roundNumber}/publish`, "POST", {}); await onChanged(); })}>Publish round {roundNumber}</button>
    <p aria-live="polite">{status}</p>
  </section>;
}
