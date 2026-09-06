import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CatalogPreparationService } from "../../src/application/catalog/catalog-preparation-service.js";
import { openSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";
import { registerCatalogRoutes } from "../../src/routes/catalog/catalog-routes.js";

const actor = { subjectId: "local:commissioner", type: "LOCAL_COMMISSIONER", label: "Commissioner", effectiveRole: "COMMISSIONER", context: {} } as const;
const meta = (key:string, version:number) => ({ actor, seasonId:"s", idempotencyKey:key, commandType:key, expectedVersion:version });

describe("paged player search", () => {
  it("normalizes search and returns deterministic bounded pages with pricing context", async () => {
    const store = await openSeasonStore(join(await mkdtemp(join(tmpdir(), "commissioner-search-")), "draft.db"));
    await store.execute({ actor, seasonId:"s", idempotencyKey:"create", commandType:"CREATE_SEASON" }, tx => tx.createSeason({ id:"s", leagueId:"l", year:2026, name:"Season", teamCount:1 }));
    await store.addCustomPlayer(meta("p1",0), { id:"p1", name:"Éddie  Gallagher", position:"K", sourceType:"LEAGUE_CUSTOM" });
    await store.addCustomPlayer(meta("p2",1), { id:"p2", name:"Eddie-Gallagher", position:"K", sourceType:"LEAGUE_CUSTOM" });
    await store.addCustomPlayer(meta("p3",2), { id:"p3", name:"Zed Kicker", position:"K", sourceType:"LEAGUE_CUSTOM" });
    await store.setPriceFloors(meta("floors",3), { K:2 });
    await store.setManualPrice(meta("manual",4), "p1", 7);
    const server=Fastify(); await registerCatalogRoutes(server,new CatalogPreparationService(store),store);
    const first=await server.inject({method:"GET",url:"/api/catalog/s/search?search=eddie%20gallagher&position=K&page=1&pageSize=1"});
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({page:1,pageSize:1,total:2,totalPages:2,items:[{id:"p1",name:"Éddie  Gallagher",minimumBid:7,priceSource:"MANUAL",availabilityReason:"AVAILABLE",stageAllowed:true}]});
    const second=await server.inject({method:"GET",url:"/api/catalog/s/search?search=eddie%20gallagher&position=K&page=2&pageSize=1"});
    expect(second.json()).toMatchObject({page:2,items:[{id:"p2",minimumBid:2,priceSource:"FLOOR"}]});
    await store.setKeeperEligibility(meta("eligible",5),["p1"]);
    const keeper=await server.inject({method:"GET",url:"/api/catalog/s/search?search=eddie&stagePolicy=KEEPER&includeUnavailable=true&pageSize=10"});
    expect(keeper.json().items).toEqual([expect.objectContaining({id:"p1",stageAllowed:true}),expect.objectContaining({id:"p2",stageAllowed:false})]);
    await server.close(); await store.close();
  });

  it("enforces paging bounds", async () => {
    const store = await openSeasonStore(join(await mkdtemp(join(tmpdir(), "commissioner-search-")), "draft.db"));
    await store.execute({ actor, seasonId:"s", idempotencyKey:"create", commandType:"CREATE_SEASON" }, tx => tx.createSeason({ id:"s", leagueId:"l", year:2026, name:"Season", teamCount:1 }));
    const server=Fastify(); await registerCatalogRoutes(server,new CatalogPreparationService(store),store);
    expect((await server.inject({method:"GET",url:"/api/catalog/s/search?pageSize=101"})).statusCode).toBe(400);
    await server.close(); await store.close();
  });

  it("applies owned precedence to reason-specific availability filters", async () => {
    const path=join(await mkdtemp(join(tmpdir(),"commissioner-search-reasons-")),"draft.db");
    let store=await openSeasonStore(path);
    await store.execute({actor,seasonId:"s",idempotencyKey:"create",commandType:"CREATE_SEASON"},tx=>tx.createSeason({id:"s",leagueId:"l",year:2026,name:"Season",teamCount:1}));
    await store.close();
    const database=new Database(path);
    database.exec(`
      INSERT INTO Team(id,leagueId,franchiseName) VALUES('t','l','Team');
      INSERT INTO SeasonTeam(id,seasonId,teamId,displayName,seedOrder,active) VALUES('st','s','t','Team',1,1);
      INSERT INTO Player(id,seasonId,name,position,sourceType,providerActive,leagueSelectable,normalizedSearchText,custom,available,keeperEligible,createdAt,updatedAt)
      VALUES
        ('owned-disabled','s','Owned Disabled','WR','NFL',1,0,'owned disabled',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
        ('free-disabled','s','Free Disabled','WR','NFL',1,0,'free disabled',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
        ('owned-inactive','s','Owned Inactive','WR','NFL',0,1,'owned inactive',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
        ('free-inactive','s','Free Inactive','WR','NFL',0,1,'free inactive',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO RosterAssignment(id,seasonId,seasonTeamId,playerId,acquisitionSource,sourceEntityId)
      VALUES('ra1','s','st','owned-disabled','AUCTION','award-1'),('ra2','s','st','owned-inactive','AUCTION','award-2');
    `);
    database.close();
    store=await openSeasonStore(path);
    expect((await store.searchCatalogPlayers(actor,"s",{availability:"LEAGUE_DISABLED",includeUnavailable:true})).items.map(item=>item.id)).toEqual(["free-disabled"]);
    expect((await store.searchCatalogPlayers(actor,"s",{availability:"CATALOG_INACTIVE",includeUnavailable:true})).items.map(item=>item.id)).toEqual(["free-inactive"]);
    expect((await store.searchCatalogPlayers(actor,"s",{availability:"OWNED"})).items.map(item=>item.id)).toEqual(["owned-disabled","owned-inactive"]);
    await store.close();
  });

  it("pages a large synthetic catalog without returning the whole collection",async()=>{
    const path=join(await mkdtemp(join(tmpdir(),"commissioner-search-large-")),"draft.db");
    let store=await openSeasonStore(path);await store.execute({actor,seasonId:"s",idempotencyKey:"create",commandType:"CREATE_SEASON"},tx=>tx.createSeason({id:"s",leagueId:"l",year:2026,name:"Season",teamCount:1}));await store.close();
    const database=new Database(path);const insert=database.prepare("INSERT INTO Player(id,seasonId,name,position,sourceType,nflTeam,providerStatus,providerActive,leagueSelectable,normalizedSearchText,custom,available,keeperEligible,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");database.transaction(()=>{for(let index=0;index<2500;index++)insert.run(`p${index}`,"s",`Synthetic Player ${String(index).padStart(4,"0")}`,"WR","NFL",index%2===0?"MIN":"GB","ACTIVE",1,1,`synthetic player ${String(index).padStart(4,"0")}`,0,1,0);})();database.close();
    store=await openSeasonStore(path);const page=await store.searchCatalogPlayers(actor,"s",{search:"synthetic",nflTeam:"min",position:"wr",sourceType:"NFL",page:20,pageSize:50});expect(page).toMatchObject({page:20,pageSize:50,total:1250,totalPages:25});expect(page.items).toHaveLength(50);expect(page.items.every(item=>item.nflTeam==="MIN"&&item.position==="WR"&&item.sourceType==="NFL")).toBe(true);expect(JSON.stringify(page).length).toBeLessThan(50_000);await store.close();
  });
});
