export const CORRECTION_TYPES = ["PICK", "AUCTION_REOPEN", "ROUND_1", "ROUND_2", "DRAFT_ORDER", "KEEPER", "CATALOG_BATCH", "CUSTOM_PLAYER", "POSITION_FLOORS", "PRICE_BATCH", "MANUAL_PRICE"] as const;
export type CorrectionType = typeof CORRECTION_TYPES[number];
export interface DependencyItem { entityType: string; id: string; order: number; label?: string; }
export interface CorrectionPreview { id: string; seasonId: string; seasonVersion: number; correctionType: CorrectionType; targetId?: string; cutHash: string; manifest: DependencyItem[]; backupHash: string; backupId: string; resumeState: string; }
