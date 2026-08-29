import { describe, expect, it } from "vitest";
import { normalizePriceList } from "../../src/application/pricing/price-list-normalizer.js";

describe("priced-player-list normalizer", () => {
  it("normalizes equivalent CSV and JSON with stable IDs and contextual fallback fields", () => {
    const csv = "sourceNamespace,sourceId,name,nflTeam,position,minimumBid\nsleeper,1,Justin Jefferson,MIN,wr,12";
    const json = JSON.stringify([{ sourceNamespace: "sleeper", sourceId: "1", name: "Justin Jefferson", nflTeam: "min", position: "WR", minimumBid: 12 }]);
    const expected = [{ rowNumber: 1, sourceNamespace: "sleeper", sourceId: "1", name: "Justin Jefferson", nflTeam: "MIN", position: "WR", minimumBid: 12 }];
    expect(normalizePriceList({ bytes: Buffer.from(csv), format: "csv" }).rows).toEqual(expected);
    expect(normalizePriceList({ bytes: Buffer.from(json), format: "json" }).rows).toEqual(expected);
  });

  it("allows custom/context-only rows but rejects invalid money, duplicates, and malformed identity", () => {
    const result = normalizePriceList({ bytes: Buffer.from(JSON.stringify([
      { name: "Eddie Gallagher", position: "K", minimumBid: 2 },
      { sourceNamespace: "sleeper", sourceId: "1", name: "A", position: "QB", minimumBid: 2 },
      { sourceNamespace: "sleeper", sourceId: "1", name: "B", position: "QB", minimumBid: 2 },
      { name: "Bad Money", position: "RB", minimumBid: 0 },
      { name: "No Position", minimumBid: 2 },
    ])), format: "json" });
    expect(result.rows).toEqual([expect.objectContaining({ name: "Eddie Gallagher", minimumBid: 2 }), expect.objectContaining({ name: "A", minimumBid: 2 })]);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/row 3.*duplicate/i), expect.stringMatching(/row 4.*positive/i), expect.stringMatching(/row 5.*position/i)]));
  });

  it.each([
    [Buffer.alloc(1025), { maxBytes: 1024 }, /size limit/i],
    [Buffer.from(JSON.stringify([{ name: "x".repeat(33), position: "K", minimumBid: 1 }])), { maxFieldLength: 32 }, /field.*limit/i],
    [Buffer.from(JSON.stringify([{ name: "A", position: "K", minimumBid: 1, extra: { too: { deep: true } } }])), { maxDepth: 3 }, /depth limit/i],
  ])("rejects hostile input before staging", (bytes, limits, message) => expect(() => normalizePriceList({ bytes, format: "json", limits })).toThrow(message));
});
