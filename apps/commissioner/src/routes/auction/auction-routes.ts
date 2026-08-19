import type { FastifyInstance } from "fastify";
import type { AuctionRoundNumber, TieDecisionInput } from "../../application/auction/auction-repository.js";
import type { AuctionService } from "../../application/auction/auction-service.js";
import { commandMetadata as metadata, localCommissioner as actor } from "../command-metadata.js";

function round(value: string): AuctionRoundNumber { const result = Number(value); if (result !== 1 && result !== 2) throw new Error("Auction round must be 1 or 2"); return result; }
const defaultRules = { positionLimits: { QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DST: 1 }, flexEligiblePositions: ["RB", "WR", "TE"], flexCapacity: 1 };

export async function registerAuctionRoutes(server: FastifyInstance, service: AuctionService) {
  server.get<{ Params: { seasonId: string; round: string }; Querystring: { reveal?: string } }>("/api/auction/:seasonId/:round", request => service.summary(actor, request.params.seasonId, round(request.params.round), request.query.reveal === "true"));
  server.post<{ Params: { seasonId: string; round: string } }>("/api/auction/:seasonId/:round/open", request => service.open(metadata(request, request.params.seasonId, "OPEN_AUCTION_ROUND"), round(request.params.round)));
  server.put<{ Params: { seasonId: string; round: string; teamId: string }; Body: { bids: Array<{ playerId: string; amount: number }>; finalize?: boolean; confirmZero?: boolean } }>("/api/auction/:seasonId/:round/teams/:teamId", async request => { await service.submit(metadata(request, request.params.seasonId, "SAVE_AUCTION_SUBMISSION"), round(request.params.round), request.params.teamId, request.body.bids, request.body); return service.summary(actor, request.params.seasonId, round(request.params.round)); });
  server.post<{ Params: { seasonId: string; round: string }; Body: { rosterRules?: typeof defaultRules } }>("/api/auction/:seasonId/:round/lock", request => service.lockAndResolve(metadata(request, request.params.seasonId, "LOCK_RESOLVE_AUCTION"), round(request.params.round), request.body.rosterRules ?? defaultRules));
  server.post<{ Params: { seasonId: string; round: string }; Body: TieDecisionInput }>("/api/auction/:seasonId/:round/ties", request => service.decideTieAndResolve(metadata(request, request.params.seasonId, "DECIDE_AUCTION_TIE"), round(request.params.round), request.body));
  server.post<{ Params: { seasonId: string; round: string } }>("/api/auction/:seasonId/:round/publish", async request => { await service.publish(metadata(request, request.params.seasonId, "PUBLISH_AUCTION_ROUND"), round(request.params.round)); return service.summary(actor, request.params.seasonId, round(request.params.round), true); });
  server.post<{ Params: { seasonId: string; round: string } }>("/api/auction/:seasonId/:round/reopen", async request => { await service.reopen(metadata(request, request.params.seasonId, "REOPEN_AUCTION_ROUND"), round(request.params.round)); return service.summary(actor, request.params.seasonId, round(request.params.round)); });
}
