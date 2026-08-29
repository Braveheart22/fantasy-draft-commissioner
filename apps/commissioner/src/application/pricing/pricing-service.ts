import type { CommandMetadata } from "../ports/season-repository.js";
import { normalizePriceList, type PriceListFormat, type PriceListLimits } from "./price-list-normalizer.js";
import type { PricingRepository } from "./pricing-repository.js";
export class PricingService {
  constructor(private readonly repository: PricingRepository, private readonly limits?: Partial<PriceListLimits>) {}
  stage(metadata: CommandMetadata, input: { sourceLabel: string; format: PriceListFormat; content: string }) {
    const normalized = normalizePriceList({ bytes: Buffer.from(input.content), format: input.format, ...(this.limits ? { limits: this.limits } : {}) });
    if (normalized.errors.length) throw new Error(`Price-list validation failed: ${normalized.errors.join("; ")}`);
    return this.repository.stagePriceList(metadata, input.sourceLabel, input.format, normalized);
  }
}
