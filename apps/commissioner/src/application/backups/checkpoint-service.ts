import type { CommandMetadata } from "../ports/season-repository.js";

export interface CheckpointOperationsPort { before(metadata: CommandMetadata, trigger: string): Promise<void>; }
export type CheckpointPort = CheckpointOperationsPort;
export class CheckpointService implements CheckpointOperationsPort {
  constructor(private readonly operations: CheckpointOperationsPort) {}
  before(metadata: CommandMetadata, trigger: string) { return this.operations.before(metadata, trigger); }
}
