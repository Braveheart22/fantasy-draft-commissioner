import type { CommandMetadata } from "../ports/season-repository.js";
import type { DraftOrderDecision, DraftOrderRepository } from "./draft-order-repository.js";
import type { CheckpointPort } from "../backups/checkpoint-service.js";

export class DraftOrderService {
  constructor(private readonly repository: DraftOrderRepository, private readonly checkpoints?: CheckpointPort) {}
  async calculate(metadata: CommandMetadata) { return this.withVersion(metadata.seasonId,await this.repository.calculate(metadata)); }
  async decide(metadata: CommandMetadata, decision: DraftOrderDecision) { return this.withVersion(metadata.seasonId,await this.repository.recordDraftOrderTieDecision(metadata, decision)); }
  async finalize(metadata: CommandMetadata) { await this.checkpoints?.before(metadata, "PRE_DRAFT_ORDER_FINALIZE"); return this.withVersion(metadata.seasonId,await this.repository.finalize(metadata)); }
  async summary(metadata: Pick<CommandMetadata, "actor" | "seasonId">) { return this.withVersion(metadata.seasonId,await this.repository.draftSummary(metadata.actor, metadata.seasonId)); }
  private async withVersion(seasonId:string,result:Awaited<ReturnType<DraftOrderRepository["draftSummary"]>>){return{...result,rowVersion:await this.repository.seasonVersion(seasonId)};}
}
