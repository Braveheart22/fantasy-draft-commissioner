import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { openDurableDatabase } from "../../server/sqlite-maintenance.js";

const CURRENT_SCHEMA_VERSION = 1;
const migrationPath = join(dirname(fileURLToPath(import.meta.url)), "../../../prisma/migrations/202608170001_u2_persistence/migration.sql");

function schemaVersion(database: Database.Database): number | undefined {
  const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='SchemaMetadata'").get();
  if (!exists) return undefined;
  return Number((database.prepare("SELECT version FROM SchemaMetadata WHERE singleton=1").get() as { version: number }).version);
}

export function applyMigrations(database: Database.Database): void {
  const version = schemaVersion(database);
  if (version !== undefined && version > CURRENT_SCHEMA_VERSION) throw new Error(`Database has newer schema version ${version}; application supports ${CURRENT_SCHEMA_VERSION}`);
  if (version === undefined) database.exec(readFileSync(migrationPath, "utf8"));
  const integrity = database.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${String(integrity)}`);
}

export function migrateDatabaseInPlace(path: string): void {
  const database = openDurableDatabase(path);
  try { applyMigrations(database); } finally { database.close(); }
}

export async function migrateDatabaseCopySafely(path: string, options: { injectFailure?: boolean } = {}): Promise<void> {
  const probe = openDurableDatabase(path);
  try { const version = schemaVersion(probe); if (version !== undefined && version > CURRENT_SCHEMA_VERSION) throw new Error(`Database has newer schema version ${version}`); } finally { probe.close(); }
  const candidate = `${path}.${randomUUID()}.migration`;
  await copyFile(path, candidate);
  try {
    if (options.injectFailure) throw new Error("Injected migration failure");
    migrateDatabaseInPlace(candidate);
    const retained = `${path}.pre-migration`;
    await rm(retained, { force: true });
    await rename(path, retained);
    try { await rename(candidate, path); } catch (error) { await rename(retained, path); throw error; }
  } finally { await rm(candidate, { force: true }); }
}
