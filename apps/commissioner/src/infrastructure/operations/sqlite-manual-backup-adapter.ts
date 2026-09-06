import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { BackupCoordinator } from "../files/backup-coordinator.js";
import type { CommandMetadata } from "../../application/ports/season-repository.js";
import type { ActorDescriptor } from "../../application/ports/actor.js";
import type { ManualBackupOperationsPort } from "../../application/backups/manual-backup-service.js";
import { recordVerifiedBackup } from "./sqlite-backup-record.js";

export class SqliteManualBackupAdapter implements ManualBackupOperationsPort {
  constructor(private readonly databasePath: string, private readonly backupDirectory: string, private readonly coordinator: BackupCoordinator) {}

  async create(metadata: CommandMetadata, destinationDirectory?: string, trigger = "MANUAL") {
    const probe = new Database(this.databasePath, { readonly: true, fileMustExist: true });
    try {
      const duplicate = probe.prepare("SELECT resultJson FROM AuditEvent WHERE seasonId=? AND actorType=? AND idempotencyKey=?").get(metadata.seasonId, metadata.actor.type, metadata.idempotencyKey) as { resultJson: string } | undefined;
      if (duplicate) return JSON.parse(duplicate.resultJson);
      const row = probe.prepare("SELECT rowVersion FROM Season WHERE id=?").get(metadata.seasonId) as { rowVersion: number } | undefined;
      if (!row || row.rowVersion !== metadata.expectedVersion) throw new Error("Stale season version");
    } finally { probe.close(); }

    const receipt = await this.coordinator.create(destinationDirectory ?? this.backupDirectory, { seasonId: metadata.seasonId, seasonVersion: metadata.expectedVersion, trigger });
    const database = new Database(this.databasePath, { fileMustExist: true });
    try {
      database.transaction(() => {
        const row = database.prepare("SELECT rowVersion FROM Season WHERE id=?").get(metadata.seasonId) as { rowVersion: number };
        if (row.rowVersion !== metadata.expectedVersion) throw new Error("Stale season version");
        recordVerifiedBackup(database, receipt, { seasonId: metadata.seasonId, trigger, seasonVersion: metadata.expectedVersion });
        const sequence = Number((database.prepare("SELECT COALESCE(MAX(sequence),0) value FROM AuditEvent WHERE seasonId=?").get(metadata.seasonId) as { value: number }).value) + 1;
        database.prepare("INSERT INTO AuditEvent(id,seasonId,sequence,actorType,actorLabel,commandType,correlationId,idempotencyKey,beforeJson,afterJson,resultJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(randomUUID(), metadata.seasonId, sequence, metadata.actor.type, metadata.actor.label, metadata.commandType, randomUUID(), metadata.idempotencyKey, JSON.stringify({ seasonVersion: metadata.expectedVersion }), JSON.stringify({ backupId: receipt.backupId }), JSON.stringify(receipt));
      })();
    } finally { database.close(); }
    return receipt;
  }

  verify(_actor: ActorDescriptor, manifestPath: string) { return this.coordinator.verify(manifestPath); }
}
