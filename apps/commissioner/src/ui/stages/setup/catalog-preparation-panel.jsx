import React, { useEffect, useMemo, useState } from "react";

function CustomPlayerEditor({ player, request, seasonId, changed }) {
  const [name, setName] = useState(player.name);
  const [position, setPosition] = useState(player.position);
  return <li><label>Edit {player.name} name <input value={name} onChange={event => setName(event.target.value)} /></label><label>Position <select value={position} onChange={event => setPosition(event.target.value)}>{["QB", "RB", "WR", "TE", "K", "DST"].map(value => <option key={value}>{value}</option>)}</select></label><button onClick={async () => { await request(`/api/catalog/${seasonId}/custom-players/${player.id}`, "PUT", { replacementId: crypto.randomUUID(), name, position }); await changed(); }}>Save custom player</button><button onClick={async () => { await request(`/api/catalog/${seasonId}/players/${player.id}/selectability`, "PUT", { leagueSelectable: !player.leagueSelectable }); await changed(); }}>{player.leagueSelectable ? "Disable" : "Enable"} {player.name}</button></li>;
}

export function CatalogPreparationPanel({ seasonId, request, onChanged }) {
  const [sourceNamespace, setSourceNamespace] = useState("canonical-nfl");
  const [format, setFormat] = useState("json");
  const [content, setContent] = useState("");
  const [batch, setBatch] = useState(null);
  const [filter, setFilter] = useState("UNRESOLVED");
  const [activeIndex, setActiveIndex] = useState(0);
  const [message, setMessage] = useState("Choose a canonical CSV or JSON file to stage an offline preview.");
  const [players, setPlayers] = useState([]);
  const [customName, setCustomName] = useState("");
  const [customPosition, setCustomPosition] = useState("K");
  const loadPlayers = async () => setPlayers(await request(`/api/catalog/${seasonId}/players`));
  useEffect(() => { void loadPlayers(); }, [seasonId]);
  const changed = async () => { await onChanged(); await loadPlayers(); };
  const visibleRows = useMemo(() => !batch ? [] : batch.rows.filter(row => filter === "ALL" || (filter === "UNRESOLVED" ? row.reviewKind && !row.disposition : row.reviewKind === filter)), [batch, filter]);
  const active = visibleRows[Math.min(activeIndex, Math.max(visibleRows.length - 1, 0))];
  const stage = async () => {
    try { const next = await request(`/api/catalog/${seasonId}/preparations`, "POST", { sourceNamespace, format, content }); setBatch(next); setActiveIndex(0); setMessage(`Staged ${next.rowCount} players; ${next.unresolvedCount} need review.`); await changed(); }
    catch (error) { setMessage(error.message); }
  };
  const resolve = async disposition => {
    if (!active) return;
    try { const next = await request(`/api/catalog/${seasonId}/preparations/${batch.id}/rows/${active.rowNumber}`, "PUT", { disposition }); setBatch(next); setMessage(`${next.unresolvedCount} review items remain.`); await changed(); }
    catch (error) { setMessage(error.message); }
  };
  const approve = async () => {
    try { await request(`/api/catalog/${seasonId}/preparations/${batch.id}/approve`, "POST", {}); setMessage(`Approved ${batch.rowCount} catalog players for offline use.`); setBatch(null); await changed(); }
    catch (error) { setMessage(error.message); }
  };
  return <section aria-labelledby="catalog-preparation-heading">
    <h3 id="catalog-preparation-heading">Catalog preparation</h3>
    <p role="status">{message}</p>
    <label>Source namespace <input value={sourceNamespace} onChange={event => setSourceNamespace(event.target.value)} /></label>
    <label>Canonical format <select value={format} onChange={event => setFormat(event.target.value)}><option value="json">JSON</option><option value="csv">CSV</option></select></label>
    <label>Catalog file <input type="file" accept=".csv,.json,text/csv,application/json" onChange={async event => { const file = event.target.files?.[0]; if (file) { setContent(await file.text()); setFormat(file.name.toLowerCase().endsWith(".csv") ? "csv" : "json"); } }} /></label>
    <button disabled={!content || !sourceNamespace} onClick={stage}>Stage catalog preview</button>
    {batch && <div className="catalog-review">
      <p>{batch.rowCount} rows · {batch.unresolvedCount} unresolved · source {batch.sourceHash.slice(0, 12)}</p>
      <label>Review category <select value={filter} onChange={event => { setFilter(event.target.value); setActiveIndex(0); }}><option value="UNRESOLVED">Unresolved only</option><option value="ALL">All rows</option><option value="CUSTOM_COLLISION">Custom collisions</option><option value="IDENTITY_CHANGE">Fact changes</option><option value="EXTERNAL_ID_CHANGE">Rekeyed players</option><option value="CROSS_SOURCE_IDENTITY">Cross-source matches</option><option value="ALIAS_COLLISION">Alias collisions</option><option value="SOURCE_OMISSION">Referenced omissions</option></select></label>
      {active ? <article><h4>{active.name}</h4><p>{active.position} · source ID {active.externalId}</p>{active.reviewMessage && <p>{active.reviewMessage}</p>}<button disabled={activeIndex === 0} onClick={() => setActiveIndex(index => index - 1)}>Previous unresolved</button><button disabled={activeIndex >= visibleRows.length - 1} onClick={() => setActiveIndex(index => index + 1)}>Next unresolved</button>{active.reviewKind && !active.disposition && (active.reviewKind === "SOURCE_OMISSION" ? <><button onClick={() => resolve("KEEP_ACTIVE")}>Keep referenced player active</button><button onClick={() => resolve("ACCEPT_OMISSION")}>Accept source omission</button></> : <><button onClick={() => resolve("ACCEPT_CHANGE")}>Accept change</button><button onClick={() => resolve("KEEP_SEPARATE")}>Keep separate player</button></>)}</article> : <p>No rows match this review filter.</p>}
      <button disabled={batch.unresolvedCount > 0} onClick={approve}>Approve catalog</button>
      {batch.unresolvedCount > 0 && <p>Resolve all {batch.unresolvedCount} remaining blockers before approval.</p>}
    </div>}
    <section><h4>League-managed players</h4><label>Custom player name <input value={customName} onChange={event => setCustomName(event.target.value)} /></label><label>Custom position <select value={customPosition} onChange={event => setCustomPosition(event.target.value)}>{["QB", "RB", "WR", "TE", "K", "DST"].map(value => <option key={value}>{value}</option>)}</select></label><button disabled={!customName.trim()} onClick={async () => { await request(`/api/setup/${seasonId}/custom-players`, "POST", { id: crypto.randomUUID(), name: customName.trim(), position: customPosition }); setCustomName(""); await changed(); }}>Create custom player</button><ul>{players.filter(player => player.sourceType === "LEAGUE_CUSTOM").map(player => <CustomPlayerEditor key={player.id} player={player} request={request} seasonId={seasonId} changed={changed} />)}</ul></section>
  </section>;
}
