import type { RosterRules } from "../conventional-draft/conventional-draft-repository.js";
import type { CommandMetadata } from "../ports/season-repository.js";
export interface ExportReceipt { id:string; backupId:string; jsonPath:string; jsonSha256:string; csvPath:string; csvSha256:string; }
export interface ExportOperationsPort { export(seasonId:string,destinationDirectory:string,rules:RosterRules,metadata:CommandMetadata): Promise<ExportReceipt>; }
export class ExportService {
  constructor(private readonly operations: ExportOperationsPort) {}
  export(metadata:CommandMetadata,destinationDirectory:string,rules:RosterRules) { return this.operations.export(metadata.seasonId,destinationDirectory,rules,metadata); }
}
