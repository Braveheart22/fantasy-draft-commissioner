import type { ActorDescriptor, CommandMetadata } from "../ports/season-repository.js";

export interface DraftOrderTieGroup { balance: number; seasonTeamIds: string[] }
export interface DraftOrderDecision { balance: number; participantTeamIds: string[]; precedenceTeamIds: string[]; method: string; note?: string; decidedAt: string }
export interface DraftOrderSummary { rowVersion?:number; status: "TIE_PAUSED" | "FINAL" | "IN_PROGRESS" | "COMPLETED"; ties: DraftOrderTieGroup[]; order: Array<{ orderPosition: number; seasonTeamId: string; displayName: string; remainingBalance: number }>; nextOverallPick: number; currentSeasonTeamId?: string }
export interface DraftOrderRepository {
  seasonVersion(seasonId:string):Promise<number>;
  calculate(metadata: CommandMetadata): Promise<DraftOrderSummary>;
  recordDraftOrderTieDecision(metadata: CommandMetadata, decision: DraftOrderDecision): Promise<DraftOrderSummary>;
  finalize(metadata: CommandMetadata): Promise<DraftOrderSummary>;
  draftSummary(actor: ActorDescriptor, seasonId: string): Promise<DraftOrderSummary>;
}
