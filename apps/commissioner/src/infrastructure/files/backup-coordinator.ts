import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";
import { APPLICATION_VERSION, type BackupManifest, type BackupReceipt } from "../../application/backups/backup-manifest.js";
import { CURRENT_SCHEMA_VERSION } from "../sqlite/migrations.js";

const sha = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
function integrity(path: string): void { const db = new Database(path, { readonly: true, fileMustExist: true }); try { const result = db.pragma("integrity_check", { simple: true }); if (result !== "ok") throw new Error(`SQLite integrity check failed: ${String(result)}`); } finally { db.close(); } }
function version(path: string): number { const db = new Database(path, { readonly: true, fileMustExist: true }); try { return Number((db.prepare("SELECT version FROM SchemaMetadata WHERE singleton=1").get() as {version:number}).version); } finally { db.close(); } }

export class BackupCoordinator {
  constructor(private readonly databasePath: string) {}

  async create(destinationDirectory: string, context: { seasonId?: string; seasonVersion?: number; trigger: string; dependencyCutHash?: string }): Promise<BackupReceipt> {
    await mkdir(destinationDirectory, { recursive: true });
    const backupId = randomUUID(); const finalPath = join(destinationDirectory, `${backupId}.db`); const manifestPath = `${finalPath}.manifest.json`;
    const tempPath = `${finalPath}.tmp`; const tempManifest = `${manifestPath}.tmp`;
    const source = new Database(this.databasePath, { fileMustExist: true });
    try {
      await source.backup(tempPath); integrity(tempPath); const digest = await sha(tempPath);
      const manifest: BackupManifest = { format: "league-draft-backup/v1", backupId, databaseFile: basename(finalPath), sha256: digest, schemaVersion: version(tempPath), applicationVersion: APPLICATION_VERSION, createdAt: new Date().toISOString(), ...context };
      await writeFile(tempManifest, JSON.stringify(manifest, null, 2), { flag: "wx" });
      await rename(tempPath, finalPath);
      try { await rename(tempManifest, manifestPath); } catch (error) { await rm(finalPath, { force: true }); throw error; }
      return { backupId, path: finalPath, manifestPath, sha256: digest, manifest };
    } finally { source.close(); await rm(tempPath, { force: true }); await rm(tempManifest, { force: true }); }
  }

  async verify(manifestPath: string): Promise<BackupReceipt> {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BackupManifest;
    if (manifest.format !== "league-draft-backup/v1") throw new Error("Unsupported backup manifest format");
    if (manifest.schemaVersion > CURRENT_SCHEMA_VERSION) throw new Error(`Backup schema ${manifest.schemaVersion} is newer than supported schema ${CURRENT_SCHEMA_VERSION}`);
    const path = join(dirname(manifestPath), manifest.databaseFile); integrity(path);
    const digest = await sha(path); if (digest !== manifest.sha256) throw new Error("Backup checksum mismatch");
    if (version(path) !== manifest.schemaVersion) throw new Error("Backup schema metadata does not match manifest");
    return { backupId: manifest.backupId, path, manifestPath, sha256: digest, manifest };
  }

  async restore(manifestPath: string, hooks: { beforeActivate?: () => void; afterActivate?: () => void } = {}): Promise<{ rollbackPath: string; receipt: BackupReceipt }> {
    const receipt = await this.verify(manifestPath); const staged = `${this.databasePath}.${randomUUID()}.restore`; const rollbackPath = `${this.databasePath}.${Date.now()}.rollback`;
    await copyFile(receipt.path, staged); integrity(staged);
    try {
      hooks.beforeActivate?.(); await rename(this.databasePath, rollbackPath);
      try { await rename(staged, this.databasePath); hooks.afterActivate?.(); integrity(this.databasePath); }
      catch (error) { await rm(this.databasePath, { force: true }); await rename(rollbackPath, this.databasePath); throw error; }
      return { rollbackPath, receipt };
    } finally { await rm(staged, { force: true }); }
  }
}
