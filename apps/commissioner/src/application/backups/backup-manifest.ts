export const APPLICATION_VERSION = "0.1.0";

export interface BackupManifest {
  format: "league-draft-backup/v1";
  backupId: string;
  databaseFile: string;
  sha256: string;
  schemaVersion: number;
  applicationVersion: string;
  createdAt: string;
  seasonId?: string;
  seasonVersion?: number;
  trigger: string;
  dependencyCutHash?: string;
}

export interface BackupReceipt {
  backupId: string;
  path: string;
  manifestPath: string;
  sha256: string;
  manifest: BackupManifest;
}
