import type { CommandMetadata } from "../ports/season-repository.js";
import type { DraftOrderDecision, DraftOrderRepository } from "./draft-order-repository.js";
import type { CheckpointPort } from "../backups/checkpoint-service.js";

export class DraftOrderService {
  constructor(private readonly repository: DraftOrderRepository, private readonly checkpoints?: CheckpointPort) {}
  calculate(metadata: CommandMetadata) { return this.repository.calculate(metadata); }
  decide(metadata: CommandMetadata, decision: DraftOrderDecision) { return this.repository.recordDraftOrderTieDecision(metadata, decision); }
  async finalize(metadata: CommandMetadata) { await this.checkpoints?.before(metadata, "PRE_DRAFT_ORDER_FINALIZE"); return this.repository.finalize(metadata); }
  summary(metadata: Pick<CommandMetadata, "actor" | "seasonId">) { return this.repository.draftSummary(metadata.actor, metadata.seasonId); }
}
