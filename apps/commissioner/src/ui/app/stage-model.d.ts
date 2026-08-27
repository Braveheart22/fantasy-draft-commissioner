export const stages: ReadonlyArray<readonly [string, string]>;
export function stageAccess(legalStage: string, requestedStage: string): { stage: string; mode: "CURRENT" | "READ_ONLY"; explanation?: string };
export function requestedStageFromHash(hash: string, fallback: string): string;
export function stageViewPolicy(access: { mode: "CURRENT" | "READ_ONLY" }): { mutationsEnabled: boolean; operationsCorrectionOnly: boolean };
