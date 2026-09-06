import type { BackupReceipt } from "./backup-manifest.js";
import type { CommandMetadata } from "../ports/season-repository.js";
import type { ActorDescriptor } from "../ports/actor.js";
export interface ManualBackupOperationsPort {
  create(metadata: CommandMetadata, destinationDirectory?: string, trigger?: string): Promise<BackupReceipt>;
  verify(actor: ActorDescriptor, manifestPath: string): Promise<BackupReceipt>;
}
export class ManualBackupService {
  constructor(private readonly operations: ManualBackupOperationsPort) {}
  create(metadata: CommandMetadata, destinationDirectory?: string, trigger?: string) { return this.operations.create(metadata, destinationDirectory, trigger); }
  verify(actor: ActorDescriptor, manifestPath: string) { return this.operations.verify(actor, manifestPath); }
}
