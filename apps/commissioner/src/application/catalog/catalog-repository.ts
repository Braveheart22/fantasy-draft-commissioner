import type { ActorDescriptor } from "../ports/season-repository.js";

export type AvailabilityReason = "OWNED" | "LEAGUE_DISABLED" | "CATALOG_INACTIVE" | "AVAILABLE";
export interface CatalogPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam?: string;
  sourceType: string;
  providerStatus: string;
  providerActive: boolean;
  leagueSelectable: boolean;
  keeperEligible: boolean;
  normalizedSearchText: string;
  sourceUpdatedAt?: Date;
  aliases: Array<{ sourceNamespace: string; sourceId: string }>;
  owned: boolean;
  available: boolean;
  reason: AvailabilityReason;
}
export interface CatalogQuery { search?: string; nflTeam?: string; position?: string; sourceType?: string; availability?: AvailabilityReason }
export type PlayerStagePolicy = "SETUP" | "KEEPER" | "AUCTION" | "DRAFT";
export interface PlayerSearchQuery extends CatalogQuery { page?: number; pageSize?: number; includeUnavailable?: boolean; stagePolicy?: PlayerStagePolicy }
export interface PlayerSearchItem extends CatalogPlayer {
  minimumBid?: number;
  priceSource: "MANUAL" | "LIST" | "LEGACY" | "FLOOR" | "MISSING";
  priceSourceLabel: string;
  ownerLabel?: string;
  availabilityReason: AvailabilityReason;
  stageAllowed: boolean;
}
export interface PlayerSearchPage { page: number; pageSize: number; total: number; totalPages: number; items: PlayerSearchItem[] }
export interface CatalogRepository {
  catalogPlayers(actor: ActorDescriptor, seasonId: string, query?: CatalogQuery): Promise<CatalogPlayer[]>;
  searchCatalogPlayers(actor: ActorDescriptor, seasonId: string, query?: PlayerSearchQuery): Promise<PlayerSearchPage>;
  assertAvailabilityConsistency(seasonId: string): Promise<void>;
}
