import type { CommandMetadata } from "../ports/season-repository.js";
import type { DraftOrderDecision, DraftOrderRepository } from "./draft-order-repository.js";

export class DraftOrderService {
  constructor(private readonly repository: DraftOrderRepository) {}
  calculate(metadata: CommandMetadata) { return this.repository.calculate(metadata); }
  decide(metadata: CommandMetadata, decision: DraftOrderDecision) { return this.repository.recordDraftOrderTieDecision(metadata, decision); }
  finalize(metadata: CommandMetadata) { return this.repository.finalize(metadata); }
  summary(metadata: Pick<CommandMetadata, "actor" | "seasonId">) { return this.repository.draftSummary(metadata.actor, metadata.seasonId); }
}
