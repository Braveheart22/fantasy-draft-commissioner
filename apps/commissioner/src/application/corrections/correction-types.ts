export const CORRECTION_TYPES = ["PICK", "AUCTION_REOPEN", "ROUND_1", "ROUND_2", "DRAFT_ORDER", "KEEPER"] as const;
export type CorrectionType = typeof CORRECTION_TYPES[number];
export interface DependencyItem { entityType: string; id: string; order: number; }
export interface CorrectionPreview { id: string; seasonId: string; seasonVersion: number; correctionType: CorrectionType; targetId?: string; cutHash: string; manifest: DependencyItem[]; backupHash: string; backupId: string; resumeState: string; }
