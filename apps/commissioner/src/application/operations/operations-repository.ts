import type { ActorDescriptor } from "../ports/season-repository.js";

export interface OperationsQuery {
  page?: number; pageSize?: number; stage?: string; commandType?: string; entityType?: string;
  correlationId?: string; recordState?: "ACTIVE" | "SUPERSEDED"; correctionLineage?: boolean;
}
export interface OperationsTimelineItem {
  sequence: number; createdAt: string; actorLabel: string; commandType: string; stage: string;
  entityType?: string; entityId?: string; correlationId: string; reason?: string;
}
export interface OperationsRecord {
  kind: string; id: string; label: string; detail: string; state: "ACTIVE" | "SUPERSEDED";
  correctionType?: string; targetId?: string;
}
export interface CorrectionTarget { correctionType: string; targetId?: string; label: string; detail: string; }
export interface OperationsSummary {
  timeline: { items: OperationsTimelineItem[]; page: number; pageSize: number; total: number; totalPages: number };
  records: OperationsRecord[];
  correctionTargets: CorrectionTarget[];
}
export interface OperationsRepository { operations(actor: ActorDescriptor, seasonId: string, query: OperationsQuery): Promise<OperationsSummary>; }
