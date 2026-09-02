import type { ActorDescriptor } from "../ports/season-repository.js";

export interface ResultsPlayer {
  playerId: string; playerName: string; position: string; sourceType: string;
  acquisitionSource: string; auctionRound?: number; cost?: number; overallPick?: number;
}
export interface ResultsTeam { seasonTeamId: string; displayName: string; seedOrder: number; players: ResultsPlayer[]; }
export interface ResultsHistoryItem { overallPick: number; roundNumber: number; displayName: string; playerName: string; position: string; }
export interface ResultsSummary {
  season: { id: string; name: string; year: number; state: string; rowVersion: number };
  teams: ResultsTeam[];
  history: ResultsHistoryItem[];
  backup: { available: boolean; lastVerifiedAt?: string; trigger?: string };
  exports: Array<{ id: string; createdAt: string; jsonSha256: string; csvSha256: string }>;
}
export interface ResultsRepository { results(actor: ActorDescriptor, seasonId: string): Promise<ResultsSummary>; }
