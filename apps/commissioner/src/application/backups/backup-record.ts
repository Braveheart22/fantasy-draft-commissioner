import type Database from "better-sqlite3";
import type { BackupReceipt } from "./backup-manifest.js";

export interface BackupRecordContext {
  seasonId: string;
  trigger: string;
  seasonVersion?: number;
  dependencyCutHash?: string;
}

export function recordVerifiedBackup(
  database: Database.Database,
  receipt: BackupReceipt,
  context: BackupRecordContext,
): void {
  database
    .prepare(
      "INSERT INTO BackupRecord (id,seasonId,path,manifestPath,sha256,schemaVersion,applicationVersion,trigger,seasonVersion,dependencyCutHash,verifiedAt,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
    )
    .run(
      receipt.backupId,
      context.seasonId,
      receipt.path,
      receipt.manifestPath,
      receipt.sha256,
      receipt.manifest.schemaVersion,
      receipt.manifest.applicationVersion,
      context.trigger,
      context.seasonVersion,
      context.dependencyCutHash,
    );
}
