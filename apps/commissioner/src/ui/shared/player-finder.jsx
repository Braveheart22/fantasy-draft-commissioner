import React, { useEffect, useId, useRef, useState } from "react";
import { PLAYER_POSITIONS } from "../../application/setup/setup-repository.js";

const emptyPage={page:1,pageSize:25,total:0,totalPages:0,items:[]};
export function PlayerFinder({label="Player",seasonId,request,stagePolicy="SETUP",selectedPlayerId,onSelect,initialPage=null}){
  const id=useId(),[search,setSearch]=useState(""),[position,setPosition]=useState(""),[nflTeam,setNflTeam]=useState(""),[sourceType,setSourceType]=useState(""),[availability,setAvailability]=useState("AVAILABLE"),[page,setPage]=useState(initialPage??emptyPage),[status,setStatus]=useState("");
  const requestSequence=useRef(0);
  const load=async(nextPage=1)=>{
    const sequence=++requestSequence.current;
    const query=new URLSearchParams({page:String(nextPage),pageSize:"25",stagePolicy,includeUnavailable:String(availability!=="AVAILABLE")});
    if(search)query.set("search",search);
    if(position)query.set("position",position);
    if(nflTeam)query.set("nflTeam",nflTeam);
    if(sourceType)query.set("sourceType",sourceType);
    if(availability)query.set("availability",availability);
    try{
      const result=await request(`/api/catalog/${seasonId}/search?${query}`);
      if(sequence!==requestSequence.current)return;
      setPage(result);
      setStatus(`${result.total} players found.`);
    }catch(error){if(sequence===requestSequence.current)setStatus(error.message);}
  };
  useEffect(()=>{
    if(initialPage===null){
      setPage(emptyPage);
      setStatus("Loading players.");
      void load(1);
    }
    return()=>{requestSequence.current+=1;};
  },[seasonId,stagePolicy]);
  return <section className="player-finder" aria-labelledby={`${id}-heading`}><h3 id={`${id}-heading`}>{label}</h3><label htmlFor={`${id}-search`}>{label} search</label><input id={`${id}-search`} type="search" value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")void load(1);}}/><label htmlFor={`${id}-position`}>Position</label><select id={`${id}-position`} value={position} onChange={event=>setPosition(event.target.value)}><option value="">All positions</option>{PLAYER_POSITIONS.map(value=><option key={value}>{value}</option>)}</select><label htmlFor={`${id}-team`}>NFL team</label><input id={`${id}-team`} value={nflTeam} onChange={event=>setNflTeam(event.target.value)} /><label htmlFor={`${id}-source`}>Source</label><select id={`${id}-source`} value={sourceType} onChange={event=>setSourceType(event.target.value)}><option value="">All sources</option><option value="NFL">NFL catalog</option><option value="LEAGUE_CUSTOM">League custom</option></select><label htmlFor={`${id}-availability`}>Availability</label><select id={`${id}-availability`} value={availability} onChange={event=>setAvailability(event.target.value)}><option value="AVAILABLE">Available</option><option value="">Include unavailable</option><option value="OWNED">Owned</option><option value="LEAGUE_DISABLED">League disabled</option><option value="CATALOG_INACTIVE">Catalog inactive</option></select><button type="button" onClick={()=>load(1)}>Search players</button><p aria-live="polite">{status}</p><ul>{page.items.map(player=><li key={player.id}><button type="button" aria-pressed={selectedPlayerId===player.id} disabled={!player.stageAllowed} onClick={()=>onSelect(player)}><strong>{player.name}</strong> · {player.position}{player.nflTeam?` · ${player.nflTeam}`:" · Free agent"} · {player.sourceType==="LEAGUE_CUSTOM"?"League custom":"NFL catalog"} · {player.minimumBid===undefined?"No minimum":`$${player.minimumBid}`} · {player.priceSourceLabel} · {player.ownerLabel??player.availabilityReason}</button></li>)}</ul><button type="button" disabled={page.page<=1} onClick={()=>load(page.page-1)}>Previous players</button><span>Page {page.page} of {Math.max(page.totalPages,1)}</span><button type="button" disabled={page.page>=page.totalPages} onClick={()=>load(page.page+1)}>Next players</button></section>;
}
