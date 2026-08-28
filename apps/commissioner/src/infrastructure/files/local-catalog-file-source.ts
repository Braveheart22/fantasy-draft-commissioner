import { open } from "node:fs/promises";
import type { CatalogSource, CatalogSourceArtifact, CanonicalCatalogFormat } from "../../application/catalog-sources/catalog-source.js";

export class LocalCatalogFileSource implements CatalogSource {
  constructor(private readonly path: string, private readonly format: CanonicalCatalogFormat, private readonly sourceNamespace: string, private readonly maxBytes = 10 * 1024 * 1024) {}
  async acquire(): Promise<CatalogSourceArtifact> {
    const file = await open(this.path, "r");
    try {
      const size = (await file.stat()).size;
      if (size > this.maxBytes) throw new Error(`Catalog size limit exceeded (${this.maxBytes} bytes)`);
      const bytes = Buffer.alloc(size);
      const { bytesRead } = await file.read(bytes, 0, size, 0);
      if (bytesRead !== size) throw new Error("Catalog file changed while it was being read");
      return { bytes, format: this.format, sourceNamespace: this.sourceNamespace };
    } finally { await file.close(); }
  }
}
