import type { AuctionEngineResult, CommissionerAuctionInput } from "../ports/auction-engine.js";
import type { ActorDescriptor, CommandMetadata } from "../ports/season-repository.js";

export type AuctionRoundNumber = 1 | 2;
export interface AuctionBidDraft { playerId: string; amount: number }
export interface AuctionRoundSummary {
  roundId: string; roundNumber: AuctionRoundNumber; status: string; revealed: boolean;
  teams: Array<{ seasonTeamId: string; teamId: string; displayName: string; status: string; bidCount: number; bids?: Array<{ bidId: string; priority: 1 | 2 | 3; playerId: string; amount: number }> }>;
  attempts: Array<{ attemptNumber: number; status: string; inputHash: string; outputHash: string; unresolvedTies: AuctionEngineResult["unresolvedTies"] }>;
  balances: Array<{ seasonTeamId: string; startingBudget: number; spent: number; remainingBudget: number }>;
}
export interface TieDecisionInput { tieKey: string; playerId: string; amount: number; participantTeamIds: string[]; preferredTeamId: string; method: string; note?: string; decidedAt: string }
export interface AuctionRepository {
  openRound(metadata: CommandMetadata, round: AuctionRoundNumber): Promise<AuctionRoundSummary>;
  saveSubmission(metadata: CommandMetadata, round: AuctionRoundNumber, seasonTeamId: string, bids: AuctionBidDraft[], finalize: boolean, confirmZero: boolean): Promise<void>;
  lockRound(metadata: CommandMetadata, round: AuctionRoundNumber, rosterRules: CommissionerAuctionInput["rosterRules"]): Promise<CommissionerAuctionInput>;
  frozenInput(actor: ActorDescriptor, seasonId: string, round: AuctionRoundNumber): Promise<CommissionerAuctionInput>;
  recordAttempt(metadata: CommandMetadata, round: AuctionRoundNumber, input: CommissionerAuctionInput, result: AuctionEngineResult): Promise<void>;
  recordTieDecision(metadata: CommandMetadata, round: AuctionRoundNumber, decision: TieDecisionInput): Promise<CommissionerAuctionInput>;
  publish(metadata: CommandMetadata, round: AuctionRoundNumber): Promise<void>;
  reopen(metadata: CommandMetadata, round: AuctionRoundNumber): Promise<void>;
  summary(actor: ActorDescriptor, seasonId: string, round: AuctionRoundNumber, reveal?: boolean): Promise<AuctionRoundSummary>;
}
