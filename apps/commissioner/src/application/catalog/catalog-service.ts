import type { ActorDescriptor } from "../ports/actor.js";
import type { AvailabilityReason, CatalogRepository } from "./catalog-repository.js";

export interface AvailabilityFacts { owned: boolean; leagueSelectable: boolean; providerActive: boolean }
export function deriveAvailability(facts: AvailabilityFacts): { available: boolean; reason: AvailabilityReason } {
  const reason: AvailabilityReason = facts.owned ? "OWNED" : !facts.leagueSelectable ? "LEAGUE_DISABLED" : !facts.providerActive ? "CATALOG_INACTIVE" : "AVAILABLE";
  return { available: reason === "AVAILABLE", reason };
}

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}
  players(...args: Parameters<CatalogRepository["catalogPlayers"]>) { return this.repository.catalogPlayers(...args); }
  assertConsistency(actor: ActorDescriptor, seasonId: string) { return this.repository.assertAvailabilityConsistency(actor, seasonId); }
}
