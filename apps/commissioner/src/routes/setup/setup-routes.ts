import type { FastifyInstance } from "fastify";
import type { SetupService } from "../../application/setup/setup-service.js";
import { commandMetadata as metadata, localCommissioner as actor } from "../command-metadata.js";

export async function registerSetupRoutes(server: FastifyInstance, service: SetupService) {
  server.post<{ Body: { seasonId?: string; leagueId: string; year: number; name: string; teamCount: number } }>("/api/setup/seasons", async request => {
    const seasonId = request.body.seasonId ?? "pending";
    return service.createSeason(metadata(request, seasonId, "CREATE_SEASON", false), request.body);
  });
  server.get<{ Params: { seasonId: string } }>("/api/setup/:seasonId", request => service.summary({ actor, seasonId: request.params.seasonId }));
  server.put<{ Params: { seasonId: string }; Body: { teams: Array<{ id: string; displayName: string; seedOrder: number }> } }>("/api/setup/:seasonId/teams", async request => { await service.configureTeams(metadata(request, request.params.seasonId, "CONFIGURE_TEAMS"), request.body.teams); return service.summary({ actor, seasonId: request.params.seasonId }); });
  server.post<{ Params: { seasonId: string }; Body: { id: string; name: string; position: "QB" | "RB" | "WR" | "TE" | "K" | "DST"; explicitMinimumBid?: number } }>("/api/setup/:seasonId/custom-players", async request => { await service.addCustomPlayer(metadata(request, request.params.seasonId, "ADD_CUSTOM_PLAYER"), { ...request.body, sourceType: "LEAGUE_CUSTOM" }); return service.summary({ actor, seasonId: request.params.seasonId }); });
  server.post<{ Params: { seasonId: string }; Body: { namespace: string; content: string; format: "csv" | "json" } }>("/api/setup/:seasonId/imports/preview", request => service.previewImport({ actor, seasonId: request.params.seasonId, commandType: "PREVIEW_IMPORT", idempotencyKey: "read-only-preview" }, request.body.namespace, request.body.content, request.body.format));
  server.post<{ Params: { seasonId: string }; Body: { namespace: string; format: "csv" | "json"; preview: Parameters<SetupService["commitImport"]>[3] } }>("/api/setup/:seasonId/imports", request => service.commitImport(metadata(request, request.params.seasonId, "COMMIT_IMPORT"), request.body.namespace, request.body.format, request.body.preview));
  server.put<{ Params: { seasonId: string }; Body: { floors: Record<string, number> } }>("/api/setup/:seasonId/pricing", async request => { await service.setPriceFloors(metadata(request, request.params.seasonId, "SET_PRICE_FLOORS"), request.body.floors); return service.summary({ actor, seasonId: request.params.seasonId }); });
  server.put<{ Params: { seasonId: string }; Body: { playerIds: string[] } }>("/api/setup/:seasonId/keeper-eligibility", async request => { await service.setKeeperEligibility(metadata(request, request.params.seasonId, "SET_KEEPER_ELIGIBILITY"), request.body.playerIds); return service.summary({ actor, seasonId: request.params.seasonId }); });
  server.put<{ Params: { seasonId: string; teamId: string }; Body: { playerId?: string } }>("/api/setup/:seasonId/teams/:teamId/keeper", async request => { await service.selectKeeper(metadata(request, request.params.seasonId, "SELECT_KEEPER"), request.params.teamId, request.body.playerId); return service.summary({ actor, seasonId: request.params.seasonId }); });
  server.post<{ Params: { seasonId: string }; Body: { rosterCapacity: number } }>("/api/setup/:seasonId/lock", request => service.lockKeepers(metadata(request, request.params.seasonId, "LOCK_KEEPERS"), request.body.rosterCapacity));
}
