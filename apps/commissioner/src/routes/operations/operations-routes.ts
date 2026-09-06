import type { FastifyInstance } from "fastify";
import type { ManualBackupService } from "../../application/backups/manual-backup-service.js";
import type { CorrectionService } from "../../application/corrections/correction-service.js";
import { CORRECTION_TYPES, type CorrectionType } from "../../application/corrections/correction-types.js";
import type { RecoveryService } from "../../application/recovery/recovery-service.js";
import type { OperationsService } from "../../application/operations/operations-service.js";
import type { OperationsQuery } from "../../application/operations/operations-repository.js";
import { commandMetadata, localCommissioner } from "../command-metadata.js";

type RawOperationsQuery = Partial<Record<keyof OperationsQuery, string>>;
const stages = new Set(["SETUP", "KEEPERS", "AUCTION_1", "AUCTION_2", "DRAFT", "OPERATIONS"]);
function rejected(message: string): never { throw Object.assign(new Error(message), { statusCode: 400 }); }
function positiveInteger(value: string | undefined, fallback: number, name: string) { if (value === undefined || value === "") return fallback; if (!/^\d+$/.test(value) || Number(value) < 1) rejected(`${name} must be a positive integer`); return Number(value); }
export function parseOperationsQuery(raw: RawOperationsQuery): OperationsQuery {
  const page = positiveInteger(raw.page, 1, "page"); const pageSize = positiveInteger(raw.pageSize, 25, "pageSize");
  if (pageSize > 100) rejected("pageSize must be 100 or less");
  if (raw.stage && !stages.has(raw.stage)) rejected("Unsupported Operations stage");
  if (raw.recordState && !["ACTIVE", "SUPERSEDED"].includes(raw.recordState)) rejected("Unsupported record state");
  if (raw.correctionLineage && !["true", "false"].includes(raw.correctionLineage)) rejected("correctionLineage must be true or false");
  return { page, pageSize, ...(raw.stage ? { stage: raw.stage } : {}), ...(raw.commandType ? { commandType: raw.commandType } : {}), ...(raw.entityType ? { entityType: raw.entityType } : {}), ...(raw.correlationId ? { correlationId: raw.correlationId } : {}), ...(raw.recordState ? { recordState: raw.recordState as "ACTIVE" | "SUPERSEDED" } : {}), ...(raw.correctionLineage === "true" ? { correctionLineage: true } : {}) };
}

export async function registerOperationsRoutes(server: FastifyInstance, services: { backup: ManualBackupService; corrections: CorrectionService; recovery: RecoveryService; queries: OperationsService }) {
  server.get("/api/operations/recovery", () => services.recovery.summary(localCommissioner));
  server.get<{ Params: { seasonId: string }; Querystring: RawOperationsQuery }>("/api/operations/:seasonId", request => services.queries.read(localCommissioner, request.params.seasonId, parseOperationsQuery(request.query)));
  server.post<{ Body: { seasonId: string; destinationDirectory?: string; trigger?: string } }>("/api/operations/backups", async request => {
    const metadata = commandMetadata(request, request.body.seasonId, "CREATE_MANUAL_BACKUP");
    return services.backup.create(metadata, request.body.destinationDirectory, request.body.trigger);
  });
  server.post<{ Body: { manifestPath: string } }>("/api/operations/backups/verify", request => services.backup.verify(localCommissioner, request.body.manifestPath));
  server.post<{ Params: { seasonId: string }; Body: { correctionType: CorrectionType; targetId?: string } }>("/api/operations/:seasonId/corrections/preview", request => { if (!CORRECTION_TYPES.includes(request.body.correctionType)) rejected("Unsupported correction type"); const metadata = commandMetadata(request, request.params.seasonId, "PREVIEW_CORRECTION"); return services.corrections.preview(metadata, request.body.correctionType, request.body.targetId); });
  server.post<{ Params: { previewId: string }; Body: { seasonId: string; expectedVersion: number; cutHash: string; backupHash: string; confirmation: string; reason: string } }>("/api/operations/corrections/:previewId/confirm", request => { const metadata = commandMetadata(request, request.body.seasonId, "CONFIRM_CORRECTION"); if (metadata.expectedVersion !== request.body.expectedVersion) throw new Error("Expected version header and body must match"); const { seasonId: _seasonId, expectedVersion: _expectedVersion, ...input } = request.body; return services.corrections.confirm(metadata, request.params.previewId, input); });
}
