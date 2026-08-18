export interface BackupReceipt {
  path: string;
  sha256: string;
}

export interface DatabaseMaintenancePort {
  backup(destinationPath: string): Promise<BackupReceipt>;
  restore(candidatePath: string): Promise<void>;
}
