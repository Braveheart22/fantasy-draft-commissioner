import Database from "better-sqlite3";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RecoveryOperationsPort, RecoverySummary } from "../../application/recovery/recovery-service.js";
import type { ActorDescriptor } from "../../application/ports/actor.js";
import { CURRENT_SCHEMA_VERSION } from "../sqlite/migrations.js";

function findInterrupted(databasePath: string): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) visit(path);
      else if (entry.endsWith(".tmp") || entry.endsWith(".restore")) found.push(path);
    }
  };
  visit(dirname(databasePath));
  return found.sort();
}

export class SqliteRecoveryAdapter implements RecoveryOperationsPort {
  constructor(private readonly databasePath: string) {}

  async summary(_actor: ActorDescriptor): Promise<RecoverySummary> {
    const db = new Database(this.databasePath, { readonly: true, fileMustExist: true });
    try {
      const integrity = String(db.pragma("integrity_check", { simple: true }));
      const schemaVersion = Number((db.prepare("SELECT version FROM SchemaMetadata WHERE singleton=1").get() as { version: number }).version);
      const activeSeason = db.prepare("SELECT id,state,rowVersion FROM Season WHERE active=1 LIMIT 1").get() as RecoverySummary["activeSeason"];
      const lastCommitted = activeSeason
        ? db.prepare("SELECT commandType,sequence,createdAt FROM AuditEvent WHERE seasonId=? ORDER BY sequence DESC LIMIT 1").get(activeSeason.id) as RecoverySummary["lastCommitted"]
        : undefined;
      const lastBackup = db.prepare("SELECT id,sha256,verifiedAt FROM BackupRecord ORDER BY verifiedAt DESC LIMIT 1").get() as RecoverySummary["lastBackup"];
      return {
        integrity,
        schemaVersion,
        compatible: schemaVersion <= CURRENT_SCHEMA_VERSION,
        ...(activeSeason ? { activeSeason } : {}),
        ...(lastCommitted ? { lastCommitted } : {}),
        ...(lastBackup ? { lastBackup } : {}),
        interruptedOperations: findInterrupted(this.databasePath),
      };
    } finally {
      db.close();
    }
  }
}
