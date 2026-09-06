import type { CommandMetadata } from "../ports/season-repository.js";
import type { CorrectionPreview, CorrectionType } from "./correction-types.js";
export interface CorrectionConfirmation { seasonId:string; expectedVersion:number; cutHash:string; backupHash:string; confirmation:string; reason:string; metadata:CommandMetadata; }
export interface CorrectionOperationsPort {
  preview(seasonId:string, correctionType:CorrectionType, targetId:string|undefined, metadata:CommandMetadata): Promise<CorrectionPreview>;
  confirm(previewId:string, input:CorrectionConfirmation): Promise<CorrectionPreview>;
}
export type CorrectionConfirmationCommand = Omit<CorrectionConfirmation, "seasonId" | "expectedVersion" | "metadata">;
export class CorrectionService {
  constructor(private readonly operations: CorrectionOperationsPort) {}
  preview(metadata:CommandMetadata, correctionType:CorrectionType, targetId?:string) { return this.operations.preview(metadata.seasonId, correctionType, targetId, metadata); }
  confirm(metadata:CommandMetadata, previewId:string, input:CorrectionConfirmationCommand) {
    if (metadata.expectedVersion === undefined) throw new Error("Expected season version is required");
    return this.operations.confirm(previewId, { ...input, seasonId: metadata.seasonId, expectedVersion: metadata.expectedVersion, metadata });
  }
}
