import { describe, expect, it } from "vitest";
import { normalizeCanonicalCatalog } from "../../src/application/catalog-sources/canonical-catalog-normalizer.js";

describe("canonical catalog normalizer", () => {
  const expected = [{
    externalId: "sea",
    name: "Seattle Seahawks",
    position: "DST",
    nflTeam: "SEA",
    providerStatus: "ACTIVE",
    providerActive: true,
    leagueSelectable: true,
    aliases: [{ sourceNamespace: "canonical", sourceId: "sea" }],
  }];

  it("normalizes equivalent provider-independent CSV and JSON deterministically", () => {
    const csv = "externalId,name,position,nflTeam,providerStatus,providerActive,leagueSelectable\nsea,Seattle Seahawks,DEF,sea,active,true,true";
    const json = JSON.stringify([{ externalId: "sea", name: "Seattle Seahawks", position: "DEF", nflTeam: "sea", providerStatus: "active", providerActive: true, leagueSelectable: true }]);
    expect(normalizeCanonicalCatalog({ bytes: Buffer.from(csv), format: "csv", sourceNamespace: "canonical" }).rows).toEqual(expected);
    expect(normalizeCanonicalCatalog({ bytes: Buffer.from(json), format: "json", sourceNamespace: "canonical" }).rows).toEqual(expected);
  });

  it("normalizes free agents and explicit aliases without inventing provider identity", () => {
    const result = normalizeCanonicalCatalog({
      bytes: Buffer.from(JSON.stringify([{ externalId: "1", name: "Player One", position: "wr", nflTeam: "FA", aliases: [{ sourceNamespace: "legacy", sourceId: "old-1" }] }])),
      format: "json",
      sourceNamespace: "manual-2026",
    });
    expect(result.rows[0]).not.toHaveProperty("nflTeam");
    expect(result.rows[0]).toMatchObject({ position: "WR", aliases: [
      { sourceNamespace: "legacy", sourceId: "old-1" },
      { sourceNamespace: "manual-2026", sourceId: "1" },
    ] });
  });

  it.each([
    [Buffer.alloc(1025, "x"), { maxBytes: 1024 }, /size limit/i],
    [Buffer.from(JSON.stringify([{ externalId: "1", name: "x".repeat(33), position: "QB" }])), { maxFieldLength: 32 }, /field.*limit/i],
    [Buffer.from(JSON.stringify([{ externalId: "1", name: "A", position: "QB", extra: { nested: { too: { deep: true } } } }])), { maxDepth: 3 }, /depth limit/i],
    [Buffer.from(JSON.stringify([{ externalId: "1", name: "A", position: "QB", a: 1, b: 2 }])), { maxColumns: 4 }, /column limit/i],
  ])("rejects bounded hostile input before normalization", (bytes, limits, message) => {
    expect(() => normalizeCanonicalCatalog({ bytes, format: "json", sourceNamespace: "canonical", limits })).toThrow(message);
  });

  it("reports duplicate identities and malformed required fields as row errors", () => {
    const result = normalizeCanonicalCatalog({ bytes: Buffer.from(JSON.stringify([
      { externalId: "same", name: "One", position: "QB" },
      { externalId: "same", name: "Two", position: "RB" },
      { externalId: "3", name: "", position: "P" },
    ])), format: "json", sourceNamespace: "canonical" });
    expect(result.errors).toEqual([
      expect.stringMatching(/row 2.*duplicate/i),
      expect.stringMatching(/row 3.*required/i),
    ]);
  });

  it("normalizes a 10,000-row catalog within the preparation threshold", () => {
    const bytes = Buffer.from(JSON.stringify(Array.from({ length: 10_000 }, (_, index) => ({ externalId: String(index), name: `Player ${index}`, position: index % 2 ? "WR" : "RB" }))));
    const started = performance.now();
    const result = normalizeCanonicalCatalog({ bytes, format: "json", sourceNamespace: "synthetic" });
    expect(result).toMatchObject({ rows: { length: 10_000 }, errors: [] });
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
