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
  normalizedSearchText: string;
  sourceUpdatedAt?: Date;
  aliases: Array<{ sourceNamespace: string; sourceId: string }>;
  owned: boolean;
  available: boolean;
  reason: AvailabilityReason;
}
export interface CatalogQuery { search?: string; nflTeam?: string; position?: string; sourceType?: string; availability?: AvailabilityReason }
export interface CatalogRepository {
  catalogPlayers(actor: ActorDescriptor, seasonId: string, query?: CatalogQuery): Promise<CatalogPlayer[]>;
  assertAvailabilityConsistency(seasonId: string): Promise<void>;
}
