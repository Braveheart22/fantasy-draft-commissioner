import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeCanonicalCatalog } from "../../src/application/catalog-sources/canonical-catalog-normalizer.js";
import { SLEEPER_NFL_PLAYERS_URL, SleeperCatalogAdapter } from "../../src/integrations/sleeper-catalog-adapter.js";

const jsonResponse = (value: unknown, init: ResponseInit = {}) => { const headers = new Headers(init.headers); headers.set("content-type", "application/json"); return new Response(JSON.stringify(value), { ...init, status: init.status ?? 200, headers }); };
const artifacts = () => mkdtemp(join(tmpdir(), "commissioner-sleeper-"));

describe("Sleeper annual catalog adapter", () => {
  it("uses only the fixed endpoint and maps supported full/filtered shapes to U3 canonical rows", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      "1": { player_id: "1", full_name: "Justin Jefferson", position: "WR", team: "MIN", status: "Active", active: true, gsis_id: "00-0036322", last_changed: 1_700_000_000 },
      SEA: { player_id: "SEA", position: "DEF", team: "SEA", active: true },
      "2": { player_id: "2", first_name: "Free", last_name: "Agent", position: "RB", team: null, status: "Inactive", active: false },
      coach: { player_id: "coach", full_name: "Coach", position: "HC", active: true },
    }));
    const artifact = await new SleeperCatalogAdapter({ fetcher, artifactDirectory: await artifacts() }).acquire();
    expect(fetcher).toHaveBeenCalledWith(SLEEPER_NFL_PLAYERS_URL, expect.objectContaining({ redirect: "manual" }));
    expect(artifact).toMatchObject({ format: "json", sourceNamespace: "sleeper" });
    const normalized = normalizeCanonicalCatalog(artifact);
    expect(normalized.errors).toEqual([]);
    expect(normalized.rows).toEqual([
      expect.objectContaining({ externalId: "1", name: "Justin Jefferson", position: "WR", nflTeam: "MIN", sourceUpdatedAt: "2023-11-14T22:13:20.000Z", aliases: expect.arrayContaining([{ sourceNamespace: "gsis", sourceId: "00-0036322" }, { sourceNamespace: "sleeper", sourceId: "1" }]) }),
      expect.objectContaining({ externalId: "2", name: "Free Agent", position: "RB", providerActive: false, leagueSelectable: false }),
      expect.objectContaining({ externalId: "SEA", name: "SEA Defense", position: "DST", nflTeam: "SEA" }),
    ]);
  });

  it.each([
    [new Response("", { status: 302, headers: { location: "https://example.test/players" } }), /redirect/i],
    [new Response("slow down", { status: 429, headers: { "content-type": "text/plain" } }), /status 429/i],
    [new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }), /content type/i],
    [jsonResponse([], { headers: { "content-length": "9999" } }), /compressed size limit/i],
    [jsonResponse([]), /player map object/i],
  ])("fails closed for redirects, provider failures, and schema drift", async (response, message) => {
    const adapter = new SleeperCatalogAdapter({ fetcher: async () => response, artifactDirectory: await artifacts(), maxCompressedBytes: 100 });
    await expect(adapter.acquire()).rejects.toThrow(message);
  });

  it("rejects a streamed decompression-size overflow and removes the disposable artifact", async () => {
    const directory = await artifacts();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(80)); controller.enqueue(new Uint8Array(80)); controller.close(); } });
    const adapter = new SleeperCatalogAdapter({ fetcher: async () => new Response(body, { headers: { "content-type": "application/json", "content-length": "20" } }), artifactDirectory: directory, maxCompressedBytes: 100, maxDecodedBytes: 100 });
    await expect(adapter.acquire()).rejects.toThrow(/decoded size limit/i);
    await expect((await import("node:fs/promises")).readdir(directory)).resolves.toEqual([]);
  });

  it("times out and honors commissioner cancellation", async () => {
    const waitingFetcher = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    await expect(new SleeperCatalogAdapter({ fetcher: waitingFetcher, artifactDirectory: await artifacts(), timeoutMs: 10 }).acquire()).rejects.toThrow(/timed out/i);
    const controller = new AbortController();
    const pending = new SleeperCatalogAdapter({ fetcher: waitingFetcher, artifactDirectory: await artifacts(), timeoutMs: 10_000 }).acquire({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/i);
  });
});
