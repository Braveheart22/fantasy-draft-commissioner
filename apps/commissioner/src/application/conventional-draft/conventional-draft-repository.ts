import type { ActorDescriptor, CommandMetadata } from "../ports/season-repository.js";
import type { DraftOrderSummary } from "../draft-order/draft-order-repository.js";

export interface RosterRules { limits: Record<string, number>; flexEligible: string[]; flexCapacity: number }
export interface DraftPickInput { seasonTeamId: string; playerId: string; rosterRules: RosterRules }
export interface ConventionalDraftRepository {
  seasonVersion(seasonId:string):Promise<number>;
  makePick(metadata: CommandMetadata, input: DraftPickInput): Promise<DraftOrderSummary>;
  draftSummary(actor: ActorDescriptor, seasonId: string): Promise<DraftOrderSummary>;
}
