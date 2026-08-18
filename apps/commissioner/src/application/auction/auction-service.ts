import type { AuctionEnginePort, CommissionerAuctionInput } from "../ports/auction-engine.js";
import type { ActorDescriptor, CommandMetadata } from "../ports/season-repository.js";
import type { AuctionBidDraft, AuctionRepository, AuctionRoundNumber, TieDecisionInput } from "./auction-repository.js";
import type { CheckpointPort } from "../backups/checkpoint-service.js";

export class AuctionService {
  constructor(private readonly repository: AuctionRepository, private readonly engine: AuctionEnginePort, private readonly checkpoints?: CheckpointPort) {}
  open(metadata: CommandMetadata, round: AuctionRoundNumber) { return this.repository.openRound(metadata, round); }
  submit(metadata: CommandMetadata, round: AuctionRoundNumber, teamId: string, bids: AuctionBidDraft[], options: { finalize?: boolean; confirmZero?: boolean } = {}) {
    if (bids.length > 3) throw new Error("A submission may contain zero to three bids");
    bids.forEach((bid, index) => { if (!Number.isSafeInteger(bid.amount) || bid.amount < 1) throw new Error(`Bid ${index + 1} must be a positive whole-dollar amount`); });
    if (!bids.length && options.finalize && !options.confirmZero) throw new Error("Zero-bid submissions require explicit confirmation");
    return this.repository.saveSubmission(metadata, round, teamId, bids, Boolean(options.finalize), Boolean(options.confirmZero));
  }
  async lockAndResolve(metadata: CommandMetadata, round: AuctionRoundNumber, rosterRules: CommissionerAuctionInput["rosterRules"]) {
    await this.checkpoints?.before(metadata, `PRE_AUCTION_R${round}_LOCK`);
    const input = await this.repository.lockRound(metadata, round, rosterRules);
    return this.resolve(metadata, round, input);
  }
  async decideTieAndResolve(metadata: CommandMetadata, round: AuctionRoundNumber, decision: TieDecisionInput) {
    const input = await this.repository.recordTieDecision(metadata, round, decision);
    return this.resolve(metadata, round, input);
  }
  private async resolve(metadata: CommandMetadata, round: AuctionRoundNumber, input: CommissionerAuctionInput) {
    const result = this.engine.resolve(input);
    await this.repository.recordAttempt({ ...metadata, commandType: "RESOLVE_AUCTION_ROUND", idempotencyKey: `${metadata.idempotencyKey}:engine-attempt` }, round, input, result);
    return result;
  }
  async publish(metadata: CommandMetadata, round: AuctionRoundNumber) { await this.checkpoints?.before(metadata, `PRE_AUCTION_R${round}_PUBLICATION`); return this.repository.publish(metadata, round); }
  reopen(metadata: CommandMetadata, round: AuctionRoundNumber) { return this.repository.reopen(metadata, round); }
  summary(actor: ActorDescriptor, seasonId: string, round: AuctionRoundNumber, reveal = false) { return this.repository.summary(actor, seasonId, round, reveal); }
}
