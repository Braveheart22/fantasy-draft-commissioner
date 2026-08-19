import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { recordVerifiedBackup } from "../../application/backups/backup-record.js";
import type { CorrectionService } from "../../application/corrections/correction-service.js";
import { CORRECTION_TYPES, type CorrectionType } from "../../application/corrections/correction-types.js";
import type { RecoveryService } from "../../application/recovery/recovery-service.js";
import type { BackupCoordinator } from "../../infrastructure/files/backup-coordinator.js";
import { commandMetadata } from "../command-metadata.js";

export async function registerOperationsRoutes(server: FastifyInstance, services: { backup: BackupCoordinator; corrections: CorrectionService; recovery: RecoveryService; backupDirectory: string; databasePath: string }) {
  server.get("/api/operations/recovery", () => services.recovery.summary());
  server.post<{ Body: { seasonId: string; destinationDirectory?: string; trigger?: string } }>("/api/operations/backups", async request => {
    const metadata = commandMetadata(request, request.body.seasonId, "CREATE_MANUAL_BACKUP");
    const probe = new Database(services.databasePath, { readonly: true, fileMustExist: true });
    try { const duplicate = probe.prepare("SELECT resultJson FROM AuditEvent WHERE seasonId=? AND actorType=? AND idempotencyKey=?").get(metadata.seasonId, metadata.actor.type, metadata.idempotencyKey) as { resultJson: string } | undefined; if (duplicate) return JSON.parse(duplicate.resultJson); const row = probe.prepare("SELECT rowVersion FROM Season WHERE id=?").get(metadata.seasonId) as { rowVersion: number } | undefined; if (!row || row.rowVersion !== metadata.expectedVersion) throw new Error("Stale season version"); } finally { probe.close(); }
    const receipt = await services.backup.create(request.body.destinationDirectory ?? services.backupDirectory, { seasonId: metadata.seasonId, seasonVersion: metadata.expectedVersion, trigger: request.body.trigger ?? "MANUAL" });
    const database = new Database(services.databasePath, { fileMustExist: true });
    try { database.transaction(() => { const row = database.prepare("SELECT rowVersion FROM Season WHERE id=?").get(metadata.seasonId) as { rowVersion: number }; if (row.rowVersion !== metadata.expectedVersion) throw new Error("Stale season version"); recordVerifiedBackup(database, receipt, { seasonId: metadata.seasonId, trigger: request.body.trigger ?? "MANUAL", seasonVersion: metadata.expectedVersion }); const sequence = Number((database.prepare("SELECT COALESCE(MAX(sequence),0) value FROM AuditEvent WHERE seasonId=?").get(metadata.seasonId) as { value: number }).value) + 1; database.prepare("INSERT INTO AuditEvent(id,seasonId,sequence,actorType,actorLabel,commandType,correlationId,idempotencyKey,beforeJson,afterJson,resultJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(randomUUID(), metadata.seasonId, sequence, metadata.actor.type, metadata.actor.label, metadata.commandType, randomUUID(), metadata.idempotencyKey, JSON.stringify({ seasonVersion: metadata.expectedVersion }), JSON.stringify({ backupId: receipt.backupId }), JSON.stringify(receipt)); })(); } finally { database.close(); }
    return receipt;
  });
  server.post<{ Body: { manifestPath: string } }>("/api/operations/backups/verify", request => services.backup.verify(request.body.manifestPath));
  server.post<{ Params: { seasonId: string }; Body: { correctionType: CorrectionType; targetId?: string } }>("/api/operations/:seasonId/corrections/preview", request => { if (!CORRECTION_TYPES.includes(request.body.correctionType)) throw new Error("Unsupported correction type"); const metadata = commandMetadata(request, request.params.seasonId, "PREVIEW_CORRECTION"); return services.corrections.preview(request.params.seasonId, request.body.correctionType, request.body.targetId, metadata); });
  server.post<{ Params: { previewId: string }; Body: { seasonId: string; expectedVersion: number; cutHash: string; backupHash: string; confirmation: string; reason: string } }>("/api/operations/corrections/:previewId/confirm", request => { const metadata = commandMetadata(request, request.body.seasonId, "CONFIRM_CORRECTION"); if (metadata.expectedVersion !== request.body.expectedVersion) throw new Error("Expected version header and body must match"); return services.corrections.confirm(request.params.previewId, { ...request.body, idempotencyKey: metadata.idempotencyKey }); });
}
