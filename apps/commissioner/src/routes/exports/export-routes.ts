import type { FastifyInstance } from "fastify";
import type { RosterRules } from "../../application/conventional-draft/conventional-draft-repository.js";
import type { ExportService } from "../../application/exports/export-service.js";

export async function registerExportRoutes(server:FastifyInstance,exports:ExportService,defaultDirectory:string){
  server.post<{Params:{seasonId:string};Body:{destinationDirectory?:string;rosterRules:RosterRules}}>("/api/exports/:seasonId",request=>exports.export(request.params.seasonId,request.body.destinationDirectory??defaultDirectory,request.body.rosterRules));
}
