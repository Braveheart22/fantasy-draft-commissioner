import { join } from "node:path";
import Database from "better-sqlite3";
import type { CommandMetadata } from "../../application/ports/season-repository.js";
import { BackupCoordinator } from "../files/backup-coordinator.js";
import { recordVerifiedBackup } from "./sqlite-backup-record.js";
import type { CheckpointOperationsPort } from "../../application/backups/checkpoint-service.js";

export class SqliteCheckpointAdapter implements CheckpointOperationsPort {
  constructor(private readonly databasePath: string, private readonly backupDirectory: string, private readonly coordinator = new BackupCoordinator(databasePath)) {}

  async before(metadata: CommandMetadata, trigger: string): Promise<void> {
    const receipt = await this.coordinator.create(join(this.backupDirectory, metadata.seasonId), {
      seasonId: metadata.seasonId,
      ...(metadata.expectedVersion !== undefined ? { seasonVersion: metadata.expectedVersion } : {}),
      trigger,
    });
    const db = new Database(this.databasePath, { fileMustExist: true });
    try {
      recordVerifiedBackup(db, receipt, {
        seasonId: metadata.seasonId,
        trigger,
        ...(metadata.expectedVersion !== undefined
          ? { seasonVersion: metadata.expectedVersion }
          : {}),
      });
    } finally { db.close(); }
  }
}
