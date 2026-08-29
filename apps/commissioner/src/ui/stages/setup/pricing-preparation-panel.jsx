import React, { useEffect, useMemo, useState } from "react";

const positions = ["QB", "RB", "WR", "TE", "K", "DST"];

export function PricingPreparationPanel({ seasonId, seasonVersion, request, onChanged }) {
  const [summary, setSummary] = useState(null);
  const [sourceLabel, setSourceLabel] = useState("commissioner-price-list");
  const [format, setFormat] = useState("json");
  const [content, setContent] = useState("");
  const [batch, setBatch] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [message, setMessage] = useState("Set positional floors or stage a provider-independent CSV or JSON price list.");
  const [manual, setManual] = useState({});

  const load = async () => setSummary(await request(`/api/pricing/${seasonId}`));
  useEffect(() => { void load(); }, [seasonId, seasonVersion]);
  const changed = async () => { await onChanged(); await load(); };
  const unresolved = useMemo(() => batch?.rows.filter(row => !row.resolutionPlayerId) ?? [], [batch]);
  const active = unresolved[Math.min(activeIndex, Math.max(unresolved.length - 1, 0))];

  const setFloors = async () => {
    try {
      const floors = Object.fromEntries(positions.map(position => [position, Number(document.getElementById(`floor-${position}`).value)]));
      await request(`/api/setup/${seasonId}/pricing`, "PUT", { floors });
      setMessage("Positional floors saved.");
      await changed();
    } catch (error) { setMessage(error.message); }
  };
  const stage = async () => {
    try {
      const next = await request(`/api/pricing/${seasonId}/preparations`, "POST", { sourceLabel, format, content });
      setBatch(next); setActiveIndex(0); setMessage(`Staged ${next.rowCount} prices; ${next.unresolvedCount} need review.`); await changed();
    } catch (error) { setMessage(error.message); }
  };
  const resolve = async playerId => {
    try {
      const next = await request(`/api/pricing/${seasonId}/preparations/${batch.id}/rows/${active.rowNumber}`, "PUT", { resolutionPlayerId: playerId });
      setBatch(next); setActiveIndex(0); setMessage(`${next.unresolvedCount} price matches remain.`); await changed();
    } catch (error) { setMessage(error.message); }
  };
  const approve = async () => {
    try { await request(`/api/pricing/${seasonId}/preparations/${batch.id}/approve`, "POST", {}); setBatch(null); setMessage("Price list approved for offline draft-night use."); await changed(); }
    catch (error) { setMessage(error.message); }
  };

  return <section aria-labelledby="pricing-preparation-heading">
    <h3 id="pricing-preparation-heading">Auction pricing</h3>
    <p role="status">{message}</p>
    <div>{positions.map(position => <label key={position}>{position} floor <input id={`floor-${position}`} aria-label={`${position} floor`} type="number" min="1" step="1" defaultValue={summary?.floors[position] ?? 1} /></label>)}</div>
    <button onClick={setFloors}>Save positional floors</button>
    <h4>Priced-player list</h4>
    <label>Price source label <input value={sourceLabel} onChange={event => setSourceLabel(event.target.value)} /></label>
    <label>Price-list format <select value={format} onChange={event => setFormat(event.target.value)}><option value="json">JSON</option><option value="csv">CSV</option></select></label>
    <label>Price-list file <input type="file" accept=".csv,.json,text/csv,application/json" onChange={async event => { const file = event.target.files?.[0]; if (file) { setContent(await file.text()); setFormat(file.name.toLowerCase().endsWith(".csv") ? "csv" : "json"); } }} /></label>
    <button disabled={!content || !sourceLabel.trim()} onClick={stage}>Stage price-list preview</button>
    {batch && <div className="price-review"><p>{batch.rowCount} rows · {batch.unresolvedCount} unresolved</p>{active ? <article><h4>{active.name} · ${active.minimumBid}</h4><p>{active.matchKind}: {active.reviewMessage ?? "Choose the matching catalog player."}</p><label>Resolve to player <select aria-label="Resolve price player" defaultValue="" onChange={event => event.target.value && resolve(event.target.value)}><option value="">Choose player</option>{summary?.players.map(player => <option key={player.playerId} value={player.playerId}>{player.name} ({player.position})</option>)}</select></label><button disabled={activeIndex === 0} onClick={() => setActiveIndex(index => index - 1)}>Previous unresolved</button><button disabled={activeIndex >= unresolved.length - 1} onClick={() => setActiveIndex(index => index + 1)}>Next unresolved</button></article> : <p>All rows are matched and ready for approval.</p>}<button disabled={batch.unresolvedCount > 0} onClick={approve}>Approve price list</button></div>}
    {summary && <><p>{summary.preflight.pricedCount} priced · {summary.preflight.missingCount} missing · {summary.preflight.unresolvedBatchCount} pending lists</p><ul className="pricing-list">{summary.players.map(player => <li key={player.playerId}><span>{player.name} ({player.position}) — {player.minimumBid === undefined ? "missing" : `$${player.minimumBid}`} · {player.sourceLabel}</span><label>Manual price <input aria-label={`Manual price for ${player.name}`} type="number" min="1" step="1" value={manual[player.playerId] ?? ""} onChange={event => setManual(values => ({ ...values, [player.playerId]: event.target.value }))} /></label><button disabled={!manual[player.playerId]} onClick={async () => { await request(`/api/pricing/${seasonId}/players/${player.playerId}/manual`, "PUT", { minimumBid: Number(manual[player.playerId]) }); setManual(values => ({ ...values, [player.playerId]: "" })); await changed(); }}>Set manual price</button><button onClick={async () => { await request(`/api/pricing/${seasonId}/players/${player.playerId}/manual`, "PUT", {}); await changed(); }}>Clear manual price</button></li>)}</ul></>}
  </section>;
}
