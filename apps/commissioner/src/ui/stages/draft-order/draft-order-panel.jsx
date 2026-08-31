import React, { useEffect, useRef, useState } from "react";
import { useStageMutationGuard } from "../../shared/stage-mutation-guard.jsx";

export function DraftOrderPanel({ seasonId, request, initialSummary, onChanged = () => {}, onPendingChange = () => {} }) {
  const [summary, setSummary] = useState(initialSummary);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  useStageMutationGuard("DRAFT_ORDER", busy || refreshRequired);
  const sequence = useRef(0);
  useEffect(() => { sequence.current++; setSummary(initialSummary); setStatus(""); setRefreshRequired(false); return () => { sequence.current++; }; }, [seasonId, initialSummary]);
  const recoveryMessage = "Draft order saved, but the season refresh failed. Reload draft order before continuing.";
  const run = async (label, action) => {
    if (busy || refreshRequired) return;
    const current = ++sequence.current;
    setBusy(true); onPendingChange(true); setStatus(label);
    try {
      const next = await action();
      if (current !== sequence.current) return;
      setSummary(next); setStatus("Saved.");
      try { await onChanged(next); }
      catch { setRefreshRequired(true); setStatus(recoveryMessage); }
    } catch (error) {
      if (current === sequence.current) {
        if (error.code === "ACKNOWLEDGED_REFRESH_FAILED") {
          setSummary(error.acknowledgedResult); setRefreshRequired(true);
        }
        setStatus(error.message);
      }
    } finally { setBusy(false); onPendingChange(false); }
  };
  const reload = async () => {
    setBusy(true); onPendingChange(true);
    try { await onChanged(); setRefreshRequired(false); setStatus("Draft order reloaded."); }
    catch (error) { setStatus(error.message); }
    finally { setBusy(false); onPendingChange(false); }
  };
  const decide = (tie, precedenceTeamIds, method) => run("Recording external tie order.", () => request(`/api/draft/${seasonId}/order/ties`, "POST", { balance: tie.balance, participantTeamIds: tie.seasonTeamIds, precedenceTeamIds, method, decidedAt: new Date().toISOString() }));
  return <section aria-label="Draft order control room"><h2>Draft Order</h2><p>Round 2 remaining budgets determine one fixed order used for every conventional round.</p>
    <button type="button" disabled={busy || refreshRequired || Boolean(summary?.order?.length)} onClick={() => run("Calculating fixed order.", () => request(`/api/draft/${seasonId}/order/calculate`, "POST"))}>Calculate order from Round 2 balances</button>
    {summary?.ties?.length > 0 && <section aria-label="External tie review"><h3>External tie review</h3>{summary.ties.map(tie => <TieReview key={`${seasonId}-${tie.balance}`} tie={tie} teams={summary.teams} busy={busy || refreshRequired} decide={decide} />)}</section>}
    {summary?.order?.length > 0 && <section><h3>Fixed order</h3><ol>{summary.order.map(team => <li key={team.seasonTeamId}>{team.displayName} · ${team.remainingBalance}</li>)}</ol></section>}
    <button type="button" disabled={busy || refreshRequired || summary?.status !== "TIE_PAUSED" || summary.ties.length > 0} onClick={() => run("Finalizing permanent order.", () => request(`/api/draft/${seasonId}/order/finalize`, "POST"))}>Finalize permanent order</button>
    {refreshRequired && <button type="button" disabled={busy} onClick={reload}>Reload draft order</button>}
    <p aria-live="polite">{status}</p></section>;
}

function TieReview({ tie, teams, busy, decide }) {
  const [precedence, setPrecedence] = useState(tie.seasonTeamIds.map(() => ""));
  const [method, setMethod] = useState("");
  const valid = method.trim() && precedence.every(Boolean) && new Set(precedence).size === tie.seasonTeamIds.length;
  return <div><p>${tie.balance} tie: record the externally decided order, first to last.</p>{precedence.map((value,index) => <label key={index}>Precedence {index+1} at ${tie.balance}<select value={value} onChange={event=>setPrecedence(items=>items.map((item,i)=>i===index?event.target.value:item))}><option value="">Choose team</option>{tie.seasonTeamIds.map(id=><option key={id} value={id}>{teams?.find(team=>team.seasonTeamId===id)?.displayName ?? id}</option>)}</select></label>)}<label>Tie decision method at ${tie.balance}<input value={method} onChange={event=>setMethod(event.target.value)} /></label><button type="button" disabled={busy || !valid} onClick={()=>decide(tie,precedence,method.trim())}>Record external order tie at ${tie.balance}</button></div>;
}
