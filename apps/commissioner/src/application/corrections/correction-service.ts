import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { BackupCoordinator } from "../../infrastructure/files/backup-coordinator.js";
import { recordVerifiedBackup } from "../backups/backup-record.js";
import { dependencyCut, resumeState } from "./dependency-registry.js";
import type { CorrectionPreview, CorrectionType, DependencyItem } from "./correction-types.js";
import type { CommandMetadata } from "../ports/season-repository.js";

const hashCut = (items: DependencyItem[]) => createHash("sha256").update(JSON.stringify(items)).digest("hex");

export class CorrectionService {
  constructor(private readonly databasePath: string, private readonly backupDirectory: string, private readonly backups = new BackupCoordinator(databasePath)) {}

  async preview(seasonId: string, correctionType: CorrectionType, targetId?: string, metadata?: CommandMetadata): Promise<CorrectionPreview> {
    const db = new Database(this.databasePath, { fileMustExist: true });
    let seasonVersion: number;
    let manifest: DependencyItem[];
    let nextState = resumeState(correctionType);
    try {
      if (metadata) { const duplicate = db.prepare("SELECT resultJson FROM AuditEvent WHERE seasonId=? AND actorType=? AND idempotencyKey=?").get(seasonId, metadata.actor.type, metadata.idempotencyKey) as { resultJson: string } | undefined; if (duplicate) return JSON.parse(duplicate.resultJson) as CorrectionPreview; }
      seasonVersion = Number((db.prepare("SELECT rowVersion FROM Season WHERE id=?").get(seasonId) as { rowVersion: number } | undefined)?.rowVersion ?? NaN);
      if (!Number.isInteger(seasonVersion)) throw new Error("Season not found");
      if (metadata && metadata.expectedVersion !== seasonVersion) throw new Error("Stale season version");
      manifest = dependencyCut(db, seasonId, correctionType, targetId);
      if (correctionType === "AUCTION_REOPEN") {
        const round = db.prepare("SELECT roundNumber FROM AuctionRound WHERE id=? AND seasonId=?").get(targetId, seasonId) as { roundNumber: number } | undefined;
        if (!round) throw new Error("Auction round target not found");
        nextState = round.roundNumber === 2 ? "R2_BIDDING" : "R1_BIDDING";
      }
    } finally { db.close(); }
    const cutHash = hashCut(manifest);
    const backup = await this.backups.create(join(this.backupDirectory, seasonId), { seasonId, seasonVersion, dependencyCutHash: cutHash, trigger: "PRE_CORRECTION" });
    const id = randomUUID();
    const preview: CorrectionPreview = { id, seasonId, seasonVersion, correctionType, ...(targetId ? { targetId } : {}), cutHash, manifest, backupHash: backup.sha256, backupId: backup.backupId, resumeState: nextState };
    const writer = new Database(this.databasePath, { fileMustExist: true });
    try {
      writer.transaction(() => {
        const current = Number((writer.prepare("SELECT rowVersion FROM Season WHERE id=?").get(seasonId) as { rowVersion: number }).rowVersion); if (current !== seasonVersion) throw new Error("Stale season version");
        writer.prepare("INSERT INTO CorrectionAction (id,seasonId,correctionType,targetId,seasonVersion,dependencyCutHash,impactJson,backupHash,createdAt) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(id, seasonId, correctionType, targetId ?? null, seasonVersion, cutHash, JSON.stringify(preview), backup.sha256);
        recordVerifiedBackup(writer, backup, {
          seasonId,
          trigger: "PRE_CORRECTION",
          seasonVersion,
          dependencyCutHash: cutHash,
        });
        if (metadata) { const sequence = Number((writer.prepare("SELECT COALESCE(MAX(sequence),0) value FROM AuditEvent WHERE seasonId=?").get(seasonId) as { value: number }).value) + 1; writer.prepare("INSERT INTO AuditEvent(id,seasonId,sequence,actorType,actorLabel,commandType,entityType,entityId,correlationId,idempotencyKey,beforeJson,afterJson,resultJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(randomUUID(), seasonId, sequence, metadata.actor.type, metadata.actor.label, metadata.commandType, "CorrectionAction", id, metadata.correlationId ?? randomUUID(), metadata.idempotencyKey, JSON.stringify({ seasonVersion }), JSON.stringify({ previewId: id, cutHash }), JSON.stringify(preview)); }
      })();
    } finally { writer.close(); }
    return preview;
  }

  confirm(previewId: string, input: { expectedVersion: number; cutHash: string; backupHash: string; confirmation: string; reason: string; actorLabel?: string; idempotencyKey?: string }): CorrectionPreview {
    if (input.confirmation !== "CONFIRM ROLLBACK") throw new Error("Typed confirmation must be CONFIRM ROLLBACK");
    if (!input.reason.trim()) throw new Error("Correction reason is required");
    const db = new Database(this.databasePath, { fileMustExist: true });
    db.pragma("foreign_keys=ON");
    try {
      return db.transaction(() => {
        if (input.idempotencyKey) { const duplicate = db.prepare("SELECT resultJson FROM AuditEvent WHERE idempotencyKey=? AND commandType='CONFIRM_CORRECTION'").get(input.idempotencyKey) as { resultJson: string } | undefined; if (duplicate) { const result = JSON.parse(duplicate.resultJson) as { previewId: string }; const existing = db.prepare("SELECT impactJson FROM CorrectionAction WHERE id=?").get(result.previewId) as { impactJson: string }; return JSON.parse(existing.impactJson) as CorrectionPreview; } }
        const row = db.prepare("SELECT * FROM CorrectionAction WHERE id=? AND confirmedAt IS NULL").get(previewId) as Record<string, unknown> | undefined;
        if (!row) throw new Error("Correction preview not found or already confirmed");
        const currentVersion = Number((db.prepare("SELECT rowVersion FROM Season WHERE id=?").get(row.seasonId) as { rowVersion: number }).rowVersion);
        const correctionType = String(row.correctionType) as CorrectionType;
        const targetId = row.targetId ? String(row.targetId) : undefined;
        const manifest = dependencyCut(db, String(row.seasonId), correctionType, targetId);
        const cutHash = hashCut(manifest);
        if (currentVersion !== input.expectedVersion || currentVersion !== Number(row.seasonVersion) || cutHash !== input.cutHash || cutHash !== row.dependencyCutHash || input.backupHash !== row.backupHash) throw new Error("Stale correction preview; create a fresh preview");
        const now = new Date().toISOString();
        for (const item of manifest) {
          if (item.entityType === "DraftPick") {
            db.prepare("UPDATE DraftPick SET active=0,supersededAt=? WHERE id=? AND active=1").run(now, item.id);
            db.prepare("UPDATE RosterAssignment SET supersededAt=? WHERE acquisitionSource='CONVENTIONAL' AND sourceEntityId=? AND supersededAt IS NULL").run(now, item.id);
          } else if (item.entityType === "AuctionAttempt") {
            db.prepare("UPDATE AuctionAttempt SET supersededAt=? WHERE id=? AND supersededAt IS NULL").run(now, item.id);
            db.prepare("UPDATE RosterAssignment SET supersededAt=? WHERE acquisitionSource='AUCTION' AND sourceEntityId=? AND supersededAt IS NULL").run(now, item.id);
          } else if (item.entityType === "KeeperSelection") {
            db.prepare("UPDATE KeeperSelection SET supersededAt=? WHERE id=? AND supersededAt IS NULL").run(now, item.id);
            db.prepare("UPDATE RosterAssignment SET supersededAt=? WHERE acquisitionSource='KEEPER' AND sourceEntityId=? AND supersededAt IS NULL").run(now, item.id);
          } else if (["AuctionRound", "AuctionAttempt", "AuctionTieDecision", "AuctionAward", "TeamAuctionBalance", "KeeperSelection", "DraftOrderEntry", "DraftOrderTieDecision", "ExportRecord"].includes(item.entityType)) {
            db.prepare(`UPDATE ${item.entityType} SET supersededAt=? WHERE id=? AND supersededAt IS NULL`).run(now, item.id);
          }
        }
        let state = resumeState(correctionType);
        if (correctionType === "AUCTION_REOPEN") {
          const round = db.prepare("SELECT roundNumber FROM AuctionRound WHERE id=?").get(targetId) as { roundNumber: number };
          state = round.roundNumber === 2 ? "R2_BIDDING" : "R1_BIDDING";
          db.prepare("UPDATE AuctionRound SET status='BIDDING',publishedAt=NULL WHERE id=? AND supersededAt IS NULL").run(targetId);
        }
        if (correctionType === "PICK") db.prepare("UPDATE ConventionalDraft SET status='IN_PROGRESS',completedAt=NULL WHERE seasonId=?").run(row.seasonId);
        if (correctionType === "DRAFT_ORDER") db.prepare("UPDATE ConventionalDraft SET status='RESET',completedAt=NULL,orderSnapshotId=NULL,orderHash=NULL WHERE seasonId=?").run(row.seasonId);
        db.prepare("UPDATE Player SET available=1 WHERE seasonId=? AND id NOT IN (SELECT playerId FROM RosterAssignment WHERE seasonId=? AND supersededAt IS NULL)").run(row.seasonId, row.seasonId);
        db.prepare("UPDATE Season SET state=?,rowVersion=rowVersion+1,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND rowVersion=?").run(state, row.seasonId, currentVersion);
        const sequence = Number((db.prepare("SELECT COALESCE(MAX(sequence),0) value FROM AuditEvent WHERE seasonId=?").get(row.seasonId) as { value: number }).value) + 1;
        const auditId = randomUUID();
        db.prepare("INSERT INTO AuditEvent (id,seasonId,sequence,actorType,actorLabel,commandType,entityType,entityId,correlationId,idempotencyKey,reason,beforeJson,afterJson,resultJson,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(auditId, row.seasonId, sequence, "LOCAL_COMMISSIONER", input.actorLabel ?? "Commissioner", "CONFIRM_CORRECTION", "CorrectionAction", previewId, randomUUID(), input.idempotencyKey ?? `correction:${previewId}`, input.reason, JSON.stringify({ seasonVersion: currentVersion, cutHash }), JSON.stringify({ seasonVersion: currentVersion + 1, state, superseded: manifest }), JSON.stringify({ previewId, backupHash: input.backupHash }));
        db.prepare("UPDATE CorrectionAction SET reason=?,confirmedAt=CURRENT_TIMESTAMP,resultAuditEventId=? WHERE id=?").run(input.reason, auditId, previewId);
        return JSON.parse(String(row.impactJson)) as CorrectionPreview;
      })();
    } finally { db.close(); }
  }
}
