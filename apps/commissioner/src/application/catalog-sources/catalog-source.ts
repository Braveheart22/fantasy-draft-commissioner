export type CanonicalCatalogFormat = "csv" | "json";

export interface CatalogSourceArtifact {
  bytes: Buffer;
  format: CanonicalCatalogFormat;
  sourceNamespace: string;
}

export interface CatalogSource {
  acquire(): Promise<CatalogSourceArtifact>;
}
