import React, { useState } from "react";

export function DraftOrderPanel({ seasonId, request, initialSummary, onChanged = () => {}, onPendingChange = () => {} }) {
  const [summary, setSummary] = useState(initialSummary);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (label, action) => { setBusy(true); onPendingChange(true); setStatus(label); try { const next = await action(); setSummary(next); setStatus("Saved."); await onChanged(next); } catch (error) { setStatus(error.message); } finally { setBusy(false); onPendingChange(false); } };
  const decide = tie => run("Recording external tie order.", () => request(`/api/draft/${seasonId}/order/ties`, "POST", { balance: tie.balance, participantTeamIds: tie.seasonTeamIds, precedenceTeamIds: [...tie.seasonTeamIds].reverse(), method: "commissioner-recorded external draw", decidedAt: new Date().toISOString() }));
  return <section aria-label="Draft order control room"><h2>Draft Order</h2><p>Round 2 remaining budgets determine one fixed order used for every conventional round.</p>
    <button type="button" disabled={busy || Boolean(summary?.order?.length)} onClick={() => run("Calculating fixed order.", () => request(`/api/draft/${seasonId}/order/calculate`, "POST"))}>Calculate order from Round 2 balances</button>
    {summary?.ties?.length > 0 && <section aria-label="External tie review"><h3>External tie review</h3>{summary.ties.map(tie => <div key={tie.balance}><p>${tie.balance} tie: {tie.seasonTeamIds.length} teams</p><button type="button" disabled={busy} onClick={() => decide(tie)}>Record external order tie at ${tie.balance}</button></div>)}</section>}
    {summary?.order?.length > 0 && <section><h3>Fixed order</h3><ol>{summary.order.map(team => <li key={team.seasonTeamId}>{team.displayName} · ${team.remainingBalance}</li>)}</ol></section>}
    <button type="button" disabled={busy || summary?.status !== "TIE_PAUSED" || summary.ties.length > 0} onClick={() => run("Finalizing permanent order.", () => request(`/api/draft/${seasonId}/order/finalize`, "POST"))}>Finalize permanent order</button>
    <p aria-live="polite">{status}</p></section>;
}
