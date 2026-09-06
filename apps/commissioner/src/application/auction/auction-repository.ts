import type { AuctionEngineResult, CommissionerAuctionInput } from "../ports/auction-engine.js";
import type { ActorDescriptor, CommandMetadata } from "../ports/season-repository.js";

export type AuctionRoundNumber = 1 | 2;
export type AuctionSubmissionStatus = "DRAFT" | "FINAL";
export interface AuctionBidDraft { playerId: string; amount: number }
export interface AuctionSubmissionDraft {
  seasonTeamId: string;
  status: AuctionSubmissionStatus;
  bidCount: number;
  zeroConfirmed: boolean;
  bids: Array<{ bidId: string; priority: 1 | 2 | 3; playerId: string; playerName: string; position: string; minimumBid?: number; amount: number }>;
}
export interface AuctionRoundSummary {
  rowVersion?: number;
  roundId: string; roundNumber: AuctionRoundNumber; status: string; revealed: boolean;
  teams: Array<{ seasonTeamId: string; teamId: string; displayName: string; status: AuctionSubmissionStatus; bidCount: number; bids?: Array<{ bidId: string; priority: 1 | 2 | 3; playerId: string; playerName?: string; amount: number }> }>;
  attempts: Array<{ attemptNumber: number; status: string; inputHash: string; outputHash: string; unresolvedTies: AuctionEngineResult["unresolvedTies"] }>;
  balances: Array<{ seasonTeamId: string; startingBudget: number; spent: number; remainingBudget: number }>;
}
export interface TieDecisionInput { tieKey: string; playerId: string; amount: number; participantTeamIds: string[]; preferredTeamId: string; method: string; note?: string; decidedAt: string }
export interface AuctionRepository {
  seasonVersion(actor: ActorDescriptor, seasonId: string): Promise<number>;
  openRound(metadata: CommandMetadata, round: AuctionRoundNumber): Promise<AuctionRoundSummary>;
  saveSubmission(metadata: CommandMetadata, round: AuctionRoundNumber, seasonTeamId: string, bids: AuctionBidDraft[], finalize: boolean, confirmZero: boolean): Promise<void>;
  submission(actor: ActorDescriptor, seasonId: string, round: AuctionRoundNumber, seasonTeamId: string): Promise<AuctionSubmissionDraft>;
  finalizeSubmission(metadata: CommandMetadata, round: AuctionRoundNumber, seasonTeamId: string, confirmZero: boolean): Promise<void>;
  lockRound(metadata: CommandMetadata, round: AuctionRoundNumber, rosterRules: CommissionerAuctionInput["rosterRules"]): Promise<CommissionerAuctionInput>;
  frozenInput(actor: ActorDescriptor, seasonId: string, round: AuctionRoundNumber): Promise<CommissionerAuctionInput>;
  recordAttempt(metadata: CommandMetadata, round: AuctionRoundNumber, input: CommissionerAuctionInput, result: AuctionEngineResult): Promise<void>;
  recordTieDecision(metadata: CommandMetadata, round: AuctionRoundNumber, decision: TieDecisionInput): Promise<CommissionerAuctionInput>;
  publish(metadata: CommandMetadata, round: AuctionRoundNumber): Promise<void>;
  reopen(metadata: CommandMetadata, round: AuctionRoundNumber): Promise<void>;
  summary(actor: ActorDescriptor, seasonId: string, round: AuctionRoundNumber, reveal?: boolean): Promise<AuctionRoundSummary>;
}
