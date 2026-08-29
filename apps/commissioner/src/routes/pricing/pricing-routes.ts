import type { FastifyInstance } from "fastify";
import type { PricingService } from "../../application/pricing/pricing-service.js";
import type { PricingRepository } from "../../application/pricing/pricing-repository.js";
import { commandMetadata as metadata, localCommissioner as actor } from "../command-metadata.js";
export async function registerPricingRoutes(server:FastifyInstance,service:PricingService,repository:PricingRepository){
  server.get<{Params:{seasonId:string}}>("/api/pricing/:seasonId",request=>repository.pricingSummary(actor,request.params.seasonId));
  server.post<{Params:{seasonId:string};Body:{sourceLabel:string;format:"csv"|"json";content:string}}>("/api/pricing/:seasonId/preparations",async request=>{
    try{return await service.stage(metadata(request,request.params.seasonId,"STAGE_PRICE_LIST"),request.body);}
    catch(error){const rejected=error as Error&{statusCode?:number};rejected.statusCode??=400;throw rejected;}
  });
  server.get<{Params:{seasonId:string;batchId:string}}>("/api/pricing/:seasonId/preparations/:batchId",request=>repository.pricePreparation(actor,request.params.seasonId,request.params.batchId));
  server.put<{Params:{seasonId:string;batchId:string;rowNumber:string};Body:{resolutionPlayerId:string}}>("/api/pricing/:seasonId/preparations/:batchId/rows/:rowNumber",request=>repository.setPriceDisposition(metadata(request,request.params.seasonId,"REVIEW_PRICE_LIST"),request.params.batchId,Number(request.params.rowNumber),request.body.resolutionPlayerId));
  server.post<{Params:{seasonId:string;batchId:string}}>("/api/pricing/:seasonId/preparations/:batchId/approve",request=>repository.approvePriceList(metadata(request,request.params.seasonId,"APPROVE_PRICE_LIST"),request.params.batchId));
  server.put<{Params:{seasonId:string;playerId:string};Body:{minimumBid?:number}}>("/api/pricing/:seasonId/players/:playerId/manual",request=>repository.setManualPrice(metadata(request,request.params.seasonId,request.body.minimumBid===undefined?"CLEAR_MANUAL_PRICE":"SET_MANUAL_PRICE"),request.params.playerId,request.body.minimumBid));
}
