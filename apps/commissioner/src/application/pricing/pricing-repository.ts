import type { ActorDescriptor, CommandMetadata } from "../ports/season-repository.js";
import type { NormalizedPriceList, PriceListFormat } from "./price-list-normalizer.js";
export type PriceMatchKind = "STABLE_ID" | "CONTEXT_PROPOSAL" | "AMBIGUOUS" | "UNMATCHED";
export interface PricePreparationView { id: string; sourceLabel: string; state: string; expectedSeasonVersion: number; rowCount: number; unresolvedCount: number; rows: Array<{ rowNumber: number; name: string; minimumBid: number; matchKind: PriceMatchKind; matchedPlayerId?: string; disposition?: string; resolutionPlayerId?: string; reviewMessage?: string }> }
export interface PricingSummary { floors: Record<string, number>; players: Array<{ playerId: string; name: string; position: string; minimumBid?: number; source: "MANUAL" | "LIST" | "LEGACY" | "FLOOR" | "MISSING"; sourceLabel: string }>; preflight: { pricedCount: number; missingCount: number; unresolvedBatchCount: number } }
export interface PricingRepository {
  stagePriceList(metadata: CommandMetadata, sourceLabel: string, format: PriceListFormat, normalized: NormalizedPriceList): Promise<PricePreparationView>;
  pricePreparation(actor: ActorDescriptor, seasonId: string, batchId: string): Promise<PricePreparationView>;
  setPriceDisposition(metadata: CommandMetadata, batchId: string, rowNumber: number, resolutionPlayerId: string): Promise<PricePreparationView>;
  approvePriceList(metadata: CommandMetadata, batchId: string): Promise<{ batchId: string; assignedCount: number }>;
  setManualPrice(metadata: CommandMetadata, playerId: string, minimumBid?: number): Promise<void>;
  pricingSummary(actor: ActorDescriptor, seasonId: string): Promise<PricingSummary>;
}
