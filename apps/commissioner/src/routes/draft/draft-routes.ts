import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DraftOrderService } from "../../application/draft-order/draft-order-service.js";
import type { ConventionalDraftService } from "../../application/conventional-draft/conventional-draft-service.js";
import type { DraftOrderDecision } from "../../application/draft-order/draft-order-repository.js";
import type { DraftPickInput } from "../../application/conventional-draft/conventional-draft-repository.js";
import type { CommandMetadata } from "../../application/ports/season-repository.js";

const actor = { type: "LOCAL_COMMISSIONER", label: "Commissioner" } as const;
function metadata(request: FastifyRequest, seasonId: string, commandType: string): CommandMetadata { const key = request.headers["idempotency-key"]; if (typeof key !== "string" || !key) { const error = new Error("Idempotency-Key header is required") as Error & { statusCode: number }; error.statusCode = 400; throw error; } return { actor, seasonId, commandType, idempotencyKey: key }; }

export async function registerDraftRoutes(server: FastifyInstance, order: DraftOrderService, draft: ConventionalDraftService) {
  server.get<{ Params: { seasonId: string } }>("/api/draft/:seasonId", request => draft.summary({ actor, seasonId: request.params.seasonId }));
  server.post<{ Params: { seasonId: string } }>("/api/draft/:seasonId/order/calculate", request => order.calculate(metadata(request, request.params.seasonId, "CALCULATE_DRAFT_ORDER")));
  server.post<{ Params: { seasonId: string }; Body: DraftOrderDecision }>("/api/draft/:seasonId/order/ties", request => order.decide(metadata(request, request.params.seasonId, "RECORD_DRAFT_ORDER_TIE"), request.body));
  server.post<{ Params: { seasonId: string } }>("/api/draft/:seasonId/order/finalize", request => order.finalize(metadata(request, request.params.seasonId, "FINALIZE_DRAFT_ORDER")));
  server.post<{ Params: { seasonId: string }; Body: DraftPickInput }>("/api/draft/:seasonId/picks", request => draft.pick(metadata(request, request.params.seasonId, "MAKE_CONVENTIONAL_PICK"), request.body));
}
