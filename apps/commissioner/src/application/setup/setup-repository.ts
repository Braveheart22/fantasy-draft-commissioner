import type { ActorDescriptor, CommandMetadata, SeasonRecord } from "../ports/season-repository.js";

export const PLAYER_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"] as const;
export type PlayerPosition = typeof PLAYER_POSITIONS[number];
export interface TeamInput { id: string; displayName: string; seedOrder: number }
export interface PlayerInput { id: string; name: string; position: PlayerPosition; sourceType: "NFL" | "LEAGUE_CUSTOM"; sourceNamespace?: string; externalId?: string; explicitMinimumBid?: number }
export interface ImportRow extends Omit<PlayerInput, "id" | "sourceType"> { externalId: string }
export interface ImportReview { kind: "IDENTITY_COLLISION" | "EXTERNAL_ID_CHANGE" | "CUSTOM_COLLISION"; row: number; message: string }
export interface ImportPreview { hash: string; rows: ImportRow[]; errors: string[]; reviews: ImportReview[]; noOp: boolean; reviewsApproved?: boolean }
export interface SetupSummary { season: SeasonRecord; teams: Array<TeamInput & { seasonTeamId: string; keeperPlayerId?: string; startingBudget: number }>; players: Array<PlayerInput & { minimumBid?: number; available: boolean }>; floors: Record<string, number> }

export interface SetupRepository {
  configureTeams(metadata: CommandMetadata, teams: TeamInput[]): Promise<void>;
  addCustomPlayer(metadata: CommandMetadata, player: PlayerInput): Promise<void>;
  previewImport(actor: ActorDescriptor, seasonId: string, namespace: string, content: string, format: "csv" | "json"): Promise<ImportPreview>;
  commitImport(metadata: CommandMetadata, namespace: string, format: "csv" | "json", preview: ImportPreview): Promise<{ noOp: boolean; batchId?: string }>;
  setPriceFloors(metadata: CommandMetadata, floors: Record<string, number>): Promise<void>;
  setKeeperEligibility(metadata: CommandMetadata, playerIds: string[]): Promise<void>;
  selectKeeper(metadata: CommandMetadata, seasonTeamId: string, playerId?: string): Promise<void>;
  lockKeepers(metadata: CommandMetadata, rosterCapacity: number): Promise<SetupSummary>;
  setupSummary(actor: ActorDescriptor, seasonId: string): Promise<SetupSummary>;
}
