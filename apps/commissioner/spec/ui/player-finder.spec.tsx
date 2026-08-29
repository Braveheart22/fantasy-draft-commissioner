import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerFinder } from "../../src/ui/shared/player-finder.jsx";

describe("shared player finder",()=>{
  it("renders labeled filters, contextual results, retained selection, and a live status",()=>{
    const html=renderToStaticMarkup(<PlayerFinder label="Bid player" seasonId="s" request={async()=>({})} initialPage={{page:1,pageSize:25,total:1,totalPages:1,items:[{id:"p",name:"Eddie Gallagher",position:"K",sourceType:"LEAGUE_CUSTOM",providerStatus:"CUSTOM",providerActive:true,leagueSelectable:true,owned:false,available:true,availabilityReason:"AVAILABLE",stageAllowed:true,minimumBid:7,priceSource:"MANUAL",priceSourceLabel:"Commissioner override"}]}} selectedPlayerId="p" onSelect={()=>{}} />);
    expect(html).toContain("Bid player search");
    expect(html).toContain("Position");
    expect(html).toContain("Availability");
    expect(html).toContain("Eddie Gallagher");
    expect(html).toContain("$7");
    expect(html).toContain("Commissioner override");
    expect(html).toContain("League custom");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("Player ID");
  });
});
