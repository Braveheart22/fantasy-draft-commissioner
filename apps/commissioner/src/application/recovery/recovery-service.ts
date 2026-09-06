import type { ActorDescriptor } from "../ports/actor.js";
export interface RecoverySummary { integrity:string; schemaVersion:number; compatible:boolean; activeSeason?:{id:string;state:string;rowVersion:number}; lastCommitted?:{commandType:string;sequence:number;createdAt:string}; lastBackup?:{id:string;sha256:string;verifiedAt:string}; interruptedOperations:string[]; }
export interface RecoveryOperationsPort { summary(actor: ActorDescriptor): Promise<RecoverySummary>; }
export class RecoveryService {
  constructor(private readonly operations: RecoveryOperationsPort) {}
  summary(actor: ActorDescriptor) { return this.operations.summary(actor); }
}
