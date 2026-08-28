import type { FastifyInstance } from "fastify";
import type { CatalogPreparationService } from "../../application/catalog/catalog-preparation-service.js";
import type { CatalogPreparationRepository, CatalogDisposition } from "../../application/catalog/catalog-preparation-repository.js";
import type { CatalogRepository } from "../../application/catalog/catalog-repository.js";
import { commandMetadata as metadata, localCommissioner as actor } from "../command-metadata.js";

export async function registerCatalogRoutes(server: FastifyInstance, service: CatalogPreparationService, repository: CatalogPreparationRepository & CatalogRepository) {
  server.get<{ Params: { seasonId: string } }>("/api/catalog/:seasonId/players", request => repository.catalogPlayers(actor, request.params.seasonId));
  server.post<{ Params: { seasonId: string }; Body: { sourceNamespace: string; format: "csv" | "json"; content: string } }>("/api/catalog/:seasonId/preparations", async request => {
    const command = metadata(request, request.params.seasonId, "STAGE_CATALOG");
    try { return await service.stage(command, { sourceNamespace: request.body.sourceNamespace, format: request.body.format, bytes: Buffer.from(request.body.content, "utf8") }); }
    catch (error) { const rejected = error as Error & { statusCode?: number }; rejected.statusCode ??= 400; throw rejected; }
  });
  server.get<{ Params: { seasonId: string; batchId: string } }>("/api/catalog/:seasonId/preparations/:batchId", request =>
    repository.catalogPreparation(actor, request.params.seasonId, request.params.batchId));
  server.put<{ Params: { seasonId: string; batchId: string; rowNumber: string }; Body: { disposition: CatalogDisposition; resolutionPlayerId?: string } }>("/api/catalog/:seasonId/preparations/:batchId/rows/:rowNumber", request =>
    repository.setCatalogDisposition(metadata(request, request.params.seasonId, "REVIEW_CATALOG"), request.params.batchId, Number(request.params.rowNumber), request.body));
  server.post<{ Params: { seasonId: string; batchId: string } }>("/api/catalog/:seasonId/preparations/:batchId/approve", request =>
    repository.approveCatalog(metadata(request, request.params.seasonId, "APPROVE_CATALOG"), request.params.batchId));
  server.post<{ Params: { seasonId: string; batchId: string } }>("/api/catalog/:seasonId/preparations/:batchId/cancel", request =>
    repository.cancelCatalogPreparation(metadata(request, request.params.seasonId, "CANCEL_CATALOG"), request.params.batchId));
  server.put<{ Params: { seasonId: string; playerId: string }; Body: { leagueSelectable: boolean } }>("/api/catalog/:seasonId/players/:playerId/selectability", request =>
    repository.setLeagueSelectability(metadata(request, request.params.seasonId, "SET_PLAYER_SELECTABILITY"), request.params.playerId, request.body.leagueSelectable));
  server.put<{ Params: { seasonId: string; playerId: string }; Body: { replacementId?: string; name: string; position: "QB" | "RB" | "WR" | "TE" | "K" | "DST" } }>("/api/catalog/:seasonId/custom-players/:playerId", request =>
    repository.reviseCustomPlayer(metadata(request, request.params.seasonId, "REVISE_CUSTOM_PLAYER"), request.params.playerId, request.body));
}
