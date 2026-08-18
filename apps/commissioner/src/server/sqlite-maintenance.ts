import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { BackupReceipt } from "../application/ports/maintenance.js";

const BUSY_TIMEOUT_MS = 5_000;

export function openDurableDatabase(path: string): Database.Database {
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = DELETE");
  database.pragma("synchronous = FULL");
  database.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return database;
}

function verifyIntegrity(path: string): void {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const result = database.pragma("integrity_check", { simple: true });
    if (result !== "ok") throw new Error(`SQLite integrity check failed: ${String(result)}`);
  } finally {
    database.close();
  }
}

export async function verifiedBackup(database: Database.Database, destinationPath: string): Promise<BackupReceipt> {
  await mkdir(dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`;
  try {
    await database.backup(temporaryPath);
    verifyIntegrity(temporaryPath);
    const sha256 = createHash("sha256").update(await readFile(temporaryPath)).digest("hex");
    await rename(temporaryPath, destinationPath);
    return { path: destinationPath, sha256 };
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function stagedRestore(databasePath: string, candidatePath: string): Promise<void> {
  const stagedPath = `${databasePath}.${randomUUID()}.restore`;
  const rollbackPath = `${databasePath}.${randomUUID()}.rollback`;
  await copyFile(candidatePath, stagedPath);
  try {
    verifyIntegrity(stagedPath);
    await rename(databasePath, rollbackPath);
    try {
      await rename(stagedPath, databasePath);
      verifyIntegrity(databasePath);
      await rm(rollbackPath, { force: true });
    } catch (error) {
      await rm(databasePath, { force: true });
      await rename(rollbackPath, databasePath);
      throw error;
    }
  } finally {
    await rm(stagedPath, { force: true });
  }
}
