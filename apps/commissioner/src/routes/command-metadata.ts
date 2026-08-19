import type { FastifyRequest } from "fastify";
import type { CommandMetadata } from "../application/ports/season-repository.js";

export const localCommissioner = { type: "LOCAL_COMMISSIONER", label: "Commissioner" } as const;
function badRequest(message: string): never { const error = new Error(message) as Error & { statusCode: number }; error.statusCode = 400; throw error; }
export function commandMetadata(request: FastifyRequest, seasonId: string, commandType: string, requireVersion = true): CommandMetadata {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !key) badRequest("Idempotency-Key header is required");
  const rawVersion = request.headers["x-expected-season-version"];
  let expectedVersion: number | undefined;
  if (requireVersion) { expectedVersion = typeof rawVersion === "string" ? Number(rawVersion) : NaN; if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) badRequest("X-Expected-Season-Version header is required"); }
  const reason = request.headers["x-reason"];
  return { actor: localCommissioner, seasonId, commandType, idempotencyKey: key, ...(expectedVersion === undefined ? {} : { expectedVersion }), ...(typeof reason === "string" ? { reason } : {}) };
}
