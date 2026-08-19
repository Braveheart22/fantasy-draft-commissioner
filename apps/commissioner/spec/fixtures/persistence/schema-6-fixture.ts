import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

export interface BaselineColumn {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKeyOrdinal: number;
}

export interface BaselineForeignKey {
  id: number;
  sequence: number;
  table: string;
  from: string;
  to: string;
  onUpdate: string;
  onDelete: string;
  match: string;
}

export interface BaselineTable {
  name: string;
  columns: BaselineColumn[];
  foreignKeys: BaselineForeignKey[];
  rowCount: number;
  orderBy: string[];
  relationalSha256: string;
}

export interface Schema6BaselineManifest {
  format: string;
  provenance: { commit: string; tag: string; schemaVersion: number; generatedThrough: string };
  databaseFile: string;
  databaseSha256: string;
  wholeDatabaseHashPolicy: string;
  releasedBackup: { databaseFile: string; manifestFile: string; sha256: string };
  integrity: string;
  foreignKeyViolations: unknown[];
  seasons: Array<{ id: string; state: string; rowVersion: number }>;
  lifecycleResumes: string[];
  correctionResumeDefaults: Record<string, string>;
  defaultClasses: Array<{ table: string; column: string; defaultValue: string }>;
  tables: BaselineTable[];
  immutableHashes: {
    frozenSnapshots: Array<{ id: string; kind: string; sha256: string; payloadSha256: string }>;
    auctionAttempts: Array<{ id: string; roundId: string; attemptNumber: number; inputHash: string; inputJsonSha256: string; outputHash: string; outputJsonSha256: string }>;
    conventionalDraft: Array<{ id: string; orderSnapshotId: string; orderHash: string }>;
    backupRecords: Array<{ id: string; trigger: string; sha256: string; schemaVersion: number; seasonVersion: number; dependencyCutHash: string | null }>;
    exportRecords: Array<{ id: string; jsonSha256: string; csvSha256: string; schemaVersion: number }>;
    exportedFiles: { json: { file: string; sha256: string }; csv: { file: string; sha256: string } };
  };
  semanticCounts: Record<string, number>;
}

export const schema6FixtureDirectory = fileURLToPath(new URL("./schema-6", import.meta.url));
export const schema6ManifestPath = join(schema6FixtureDirectory, "baseline-manifest.json");
export const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

export async function loadSchema6Manifest(): Promise<Schema6BaselineManifest> {
  return JSON.parse(await readFile(schema6ManifestPath, "utf8")) as Schema6BaselineManifest;
}

export async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}

export function fixturePath(relativePath: string): string {
  return join(schema6FixtureDirectory, ...relativePath.split("/"));
}

export function inspectBaselineTable(database: Database.Database, table: BaselineTable) {
  const currentColumns = (database.pragma(`table_info(${quote(table.name)})`) as Array<Record<string, unknown>>).map(column => ({
    cid: Number(column.cid),
    name: String(column.name),
    type: String(column.type),
    notNull: Boolean(column.notnull),
    defaultValue: column.dflt_value === null ? null : String(column.dflt_value),
    primaryKeyOrdinal: Number(column.pk),
  }));
  const projection = table.columns.map(column => quote(column.name)).join(",");
  const ordering = table.orderBy.map(quote).join(",");
  const rows = database.prepare(`SELECT ${projection} FROM ${quote(table.name)} ORDER BY ${ordering}`).all();
  const foreignKeys = (database.pragma(`foreign_key_list(${quote(table.name)})`) as Array<Record<string, unknown>>).map(key => ({
    id: Number(key.id),
    sequence: Number(key.seq),
    table: String(key.table),
    from: String(key.from),
    to: String(key.to),
    onUpdate: String(key.on_update),
    onDelete: String(key.on_delete),
    match: String(key.match),
  })).sort((a, b) => a.id - b.id || a.sequence - b.sequence);
  return {
    preservedColumns: table.columns.map(expected => currentColumns.find(column => column.name === expected.name)),
    foreignKeys,
    rowCount: rows.length,
    relationalSha256: sha256(JSON.stringify(rows)),
  };
}

export function backupArtifactPath(backupId: string): string {
  return join(schema6FixtureDirectory, "artifacts", "backups", "season-schema-6-completed", `${backupId}.db`);
}

export function backupManifestDatabasePath(manifestPath: string, databaseFile: string): string {
  return join(dirname(manifestPath), databaseFile);
}
