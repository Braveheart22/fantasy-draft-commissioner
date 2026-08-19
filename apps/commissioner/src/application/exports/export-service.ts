import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import Database from "better-sqlite3";
import type { RosterRules } from "../conventional-draft/conventional-draft-repository.js";
import { validateRosterThroughPhase1 } from "../../integrations/roster-validator-adapter.js";
import { BackupCoordinator } from "../../infrastructure/files/backup-coordinator.js";
import { writeExportBundle } from "../../infrastructure/files/export-writer.js";
import { recordVerifiedBackup } from "../backups/backup-record.js";
import type { CommandMetadata } from "../ports/season-repository.js";

type Row={seasonId:string;year:number;seasonName:string;seasonTeamId:string;teamId:string;teamName:string;seedOrder:number;playerId:string;playerName:string;position:string;sourceType:string;custom:number;acquisitionSource:string;auctionRound:number|null;cost:number|null;overallPick:number|null;draftRound:number|null;orderPosition:number|null};
const csvCell=(value:unknown)=>{const text=value==null?"":String(value);return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;};

export class ExportService {
  constructor(private readonly databasePath:string,private readonly backupDirectory:string,private readonly backups=new BackupCoordinator(databasePath)){}
  async export(seasonId:string,destinationDirectory:string,rules:RosterRules,metadata?:CommandMetadata){
    const probe=new Database(this.databasePath,{readonly:true,fileMustExist:true});let version:number;
    try{if(metadata){const duplicate=probe.prepare("SELECT resultJson FROM AuditEvent WHERE seasonId=? AND actorType=? AND idempotencyKey=?").get(seasonId,metadata.actor.type,metadata.idempotencyKey)as{resultJson:string}|undefined;if(duplicate)return JSON.parse(duplicate.resultJson);}const season=probe.prepare("SELECT state,rowVersion FROM Season WHERE id=?").get(seasonId)as{state:string;rowVersion:number}|undefined;if(!season)throw new Error("Season not found");if(season.state!=="COMPLETED")throw new Error("Season must be complete before export");version=season.rowVersion;if(metadata?.expectedVersion!==undefined&&metadata.expectedVersion!==version)throw new Error("Stale season version");}finally{probe.close();}
    const backup=await this.backups.create(join(this.backupDirectory,seasonId),{seasonId,seasonVersion:version,trigger:"PRE_EXPORT"});
    const db=new Database(this.databasePath,{fileMustExist:true});
    try{
      const rows=db.transaction(()=>db.prepare(`SELECT s.id seasonId,s.year,s.name seasonName,st.id seasonTeamId,st.teamId,st.displayName teamName,st.seedOrder,p.id playerId,p.name playerName,p.position,p.sourceType,p.custom,ra.acquisitionSource,ra.auctionRound,ra.cost,dp.overallPick,dp.roundNumber draftRound,dp.orderPosition FROM Season s JOIN SeasonTeam st ON st.seasonId=s.id AND st.active=1 JOIN RosterAssignment ra ON ra.seasonTeamId=st.id AND ra.seasonId=s.id AND ra.supersededAt IS NULL JOIN Player p ON p.id=ra.playerId LEFT JOIN DraftPick dp ON ra.acquisitionSource='CONVENTIONAL' AND dp.id=ra.sourceEntityId AND dp.active=1 WHERE s.id=? ORDER BY st.seedOrder,p.name COLLATE BINARY,p.id`).all(seasonId)as Row[])();
      const teams=new Map<string,Row[]>();for(const row of rows){const list=teams.get(row.seasonTeamId)??[];list.push(row);teams.set(row.seasonTeamId,list);}if(!teams.size)throw new Error("Completed season has no active rosters");
      for(const roster of teams.values()){if(roster.length!==14)throw new Error("Every completed roster must contain exactly 14 active players");const result=validateRosterThroughPhase1(roster.map(row=>row.position),rules);if(!result.legal)throw new Error(`Illegal completed roster: ${result.reason}`);}
      const first=rows[0]!;const rosters=[...teams.values()].map(roster=>({team:{seasonTeamId:roster[0]!.seasonTeamId,teamId:roster[0]!.teamId,name:roster[0]!.teamName,seedOrder:roster[0]!.seedOrder},players:roster.map(row=>({id:row.playerId,name:row.playerName,position:row.position,sourceType:row.sourceType,custom:Boolean(row.custom),acquisition:{source:row.acquisitionSource,...(row.auctionRound!=null?{auctionRound:row.auctionRound}:{}),...(row.cost!=null?{cost:row.cost}:{}),...(row.overallPick!=null?{overallPick:row.overallPick,draftRound:row.draftRound,orderPosition:row.orderPosition}:{})}}))}));
      const json=JSON.stringify({format:"league-draft-export/v1",season:{id:first.seasonId,year:first.year,name:first.seasonName},rosters},null,2)+"\n";
      const headers=["season_id","team_id","team_name","player_id","player_name","position","source_type","custom","acquisition_source","auction_round","cost","overall_pick","draft_round","order_position"];
      const csv=[headers.join(","),...rows.map(row=>[row.seasonId,row.teamId,row.teamName,row.playerId,row.playerName,row.position,row.sourceType,Boolean(row.custom),row.acquisitionSource,row.auctionRound,row.cost,row.overallPick,row.draftRound,row.orderPosition].map(csvCell).join(","))].join("\n")+"\n";
      const written=await writeExportBundle(destinationDirectory,json,csv);
      const id=randomUUID();const result={id,backupId:backup.backupId,...written};
      try{db.transaction(()=>{const current=db.prepare("SELECT rowVersion,state FROM Season WHERE id=?").get(seasonId)as{rowVersion:number;state:string};if(current.rowVersion!==version||current.state!=="COMPLETED")throw new Error("Season changed during export; generated files were discarded");recordVerifiedBackup(db,backup,{seasonId,trigger:"PRE_EXPORT",seasonVersion:version});db.prepare("INSERT INTO ExportRecord(id,seasonId,backupId,jsonPath,jsonSha256,csvPath,csvSha256,schemaVersion,createdAt) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(id,seasonId,backup.backupId,written.jsonPath,written.jsonSha256,written.csvPath,written.csvSha256,1);if(metadata){const sequence=Number((db.prepare("SELECT COALESCE(MAX(sequence),0) value FROM AuditEvent WHERE seasonId=?").get(seasonId)as{value:number}).value)+1;db.prepare("INSERT INTO AuditEvent(id,seasonId,sequence,actorType,actorLabel,commandType,correlationId,idempotencyKey,beforeJson,afterJson,resultJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(randomUUID(),seasonId,sequence,metadata.actor.type,metadata.actor.label,metadata.commandType,metadata.correlationId??randomUUID(),metadata.idempotencyKey,JSON.stringify({seasonVersion:version}),JSON.stringify({exportId:id}),JSON.stringify(result));}})();}catch(error){await Promise.all([rm(written.jsonPath,{force:true}),rm(written.csvPath,{force:true})]);throw error;}
      return result;
    }finally{db.close();}
  }
}
