import type { CommandMetadata } from "../ports/season-repository.js";
import { normalizeCanonicalCatalog, type CatalogNormalizationLimits } from "../catalog-sources/canonical-catalog-normalizer.js";
import type { CatalogSource, CatalogSourceArtifact } from "../catalog-sources/catalog-source.js";
import type { CatalogPreparationRepository } from "./catalog-preparation-repository.js";

export class CatalogPreparationService {
  constructor(private readonly repository: CatalogPreparationRepository, private readonly limits?: Partial<CatalogNormalizationLimits>) {}

  stage(metadata: CommandMetadata, artifact: CatalogSourceArtifact) {
    const normalized = normalizeCanonicalCatalog({ ...artifact, ...(this.limits ? { limits: this.limits } : {}) });
    if (normalized.errors.length) throw new Error(`Catalog validation failed: ${normalized.errors.join("; ")}`);
    return this.repository.stageCatalog(metadata, artifact.sourceNamespace, artifact.format, normalized);
  }

  async stageFromSource(metadata: CommandMetadata, source: CatalogSource, options?: { signal?: AbortSignal }) {
    return this.stage(metadata, await source.acquire(options));
  }
}
