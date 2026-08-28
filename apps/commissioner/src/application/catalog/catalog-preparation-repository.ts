import type { ActorDescriptor, CommandMetadata } from "../ports/season-repository.js";
import type { CanonicalCatalogFormat } from "../catalog-sources/catalog-source.js";
import type { CatalogNormalizationResult } from "../catalog-sources/canonical-catalog-normalizer.js";

export type CatalogReviewKind = "CUSTOM_COLLISION" | "IDENTITY_CHANGE" | "EXTERNAL_ID_CHANGE" | "CROSS_SOURCE_IDENTITY" | "ALIAS_COLLISION" | "SOURCE_OMISSION";
export type CatalogDisposition = "ACCEPT_CHANGE" | "KEEP_SEPARATE" | "LINK_EXISTING" | "KEEP_ACTIVE" | "ACCEPT_OMISSION";
export interface CatalogPreparationRowView {
  rowNumber: number;
  operation: "UPSERT" | "OMIT";
  externalId: string;
  name: string;
  position: string;
  reviewKind?: CatalogReviewKind;
  reviewMessage?: string;
  disposition?: CatalogDisposition;
  resolutionPlayerId?: string;
}
export interface CatalogPreparationView {
  id: string;
  sourceNamespace: string;
  format: CanonicalCatalogFormat;
  sourceHash: string;
  normalizedHash: string;
  expectedSeasonVersion: number;
  state: "STAGED" | "APPROVED" | "CANCELLED" | "EXPIRED";
  rowCount: number;
  unresolvedCount: number;
  rows: CatalogPreparationRowView[];
}
export interface CatalogPreparationRepository {
  stageCatalog(metadata: CommandMetadata, sourceNamespace: string, format: CanonicalCatalogFormat, normalized: CatalogNormalizationResult): Promise<CatalogPreparationView>;
  catalogPreparation(actor: ActorDescriptor, seasonId: string, batchId: string): Promise<CatalogPreparationView>;
  setCatalogDisposition(metadata: CommandMetadata, batchId: string, rowNumber: number, input: { disposition: CatalogDisposition; resolutionPlayerId?: string }): Promise<CatalogPreparationView>;
  approveCatalog(metadata: CommandMetadata, batchId: string): Promise<{ batchId: string; promotedCount: number; normalizedHash: string }>;
  cancelCatalogPreparation(metadata: CommandMetadata, batchId: string): Promise<void>;
  setLeagueSelectability(metadata: CommandMetadata, playerId: string, leagueSelectable: boolean): Promise<void>;
  reviseCustomPlayer(metadata: CommandMetadata, playerId: string, input: { replacementId?: string; name: string; position: "QB" | "RB" | "WR" | "TE" | "K" | "DST" }): Promise<{ playerId: string; superseded: boolean }>;
}
