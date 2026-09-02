import React, { useEffect, useState } from "react";
import { ExportsPanel } from "../../exports/exports-panel.jsx";

export function ResultsPanel({ seasonId, request, seasonVersion }) {
  const [loaded, setLoaded] = useState(null); const [error, setError] = useState(""); const [refreshToken,setRefreshToken]=useState(0);
  useEffect(() => { let current = true; setError(""); request(`/api/results/${encodeURIComponent(seasonId)}`).then(value => { if (current) setLoaded({ seasonId, value }); }).catch(value => { if (current) setError(value.message); }); return () => { current = false; }; }, [seasonId, request, refreshToken]);
  const results = loaded?.seasonId === seasonId ? loaded.value : null;
  if (error) return <section aria-label="Final results"><h2>Results</h2><p role="alert">{error}</p></section>;
  if (!results) return <section aria-label="Final results"><h2>Results</h2><p role="status">Loading final results…</p></section>;
  return <section className="results" aria-label="Final results"><header><p className="eyebrow">Season complete</p><h2>Results</h2><p>The season is complete.</p><p>{results.season.name} · {results.season.year} · {results.teams.length} final team roster(s) · {results.history.length} conventional picks</p></header>
    <section aria-label="Final team rosters"><h3>Final rosters</h3>{results.teams.map(team=><article key={team.seasonTeamId}><h4>{team.displayName}</h4><ul>{team.players.map(player=><li key={player.playerId}><strong>{player.playerName}</strong> · {player.position} · {source(player)}{player.cost!==undefined?` · $${player.cost}`:""}{player.overallPick!==undefined?` · Pick ${player.overallPick}`:""}</li>)}</ul></article>)}</section>
    <section aria-label="Completed draft history"><h3>Completed draft history</h3><ol>{results.history.map(item=><li key={item.overallPick}>Pick {item.overallPick} · {item.playerName} · {item.position} · {item.displayName}</li>)}</ol></section>
    <section aria-label="Backup and export status"><h3>Backup & exports</h3><p>{results.backup.available?`Verified backup available · ${results.backup.trigger} · ${results.backup.lastVerifiedAt}`:"No verified backup recorded."}</p><p>{results.exports.length?`${results.exports.length} active export bundle(s).`:"No exports created yet."}</p><ExportsPanel seasonId={seasonId} seasonVersion={seasonVersion} onCreated={()=>setRefreshToken(value=>value+1)} /></section>
  </section>;
}
function source(player){return player.acquisitionSource==="KEEPER"?"Keeper":player.acquisitionSource==="AUCTION"?`Auction ${player.auctionRound??""}`.trim():"Draft";}
