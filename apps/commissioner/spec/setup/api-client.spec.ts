import { describe, expect, it, vi } from "vitest";
import { createApiClient, createSeasonActivation } from "../../src/ui/shared/api-client.js";
import { requestedStageFromHash, stageAccess, stageViewPolicy } from "../../src/ui/app/stage-model.js";

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

describe("season activation client", () => {
  it("redirects future stages and keeps completed stages read-only", () => {
    const future = stageAccess("AUCTION_1", requestedStageFromHash("#stage/DRAFT", "AUCTION_1"));
    expect(future).toMatchObject({ stage: "AUCTION_1", mode: "CURRENT", explanation: expect.stringContaining("not available") });
    const completed = stageAccess("DRAFT", "KEEPERS");
    expect(completed).toMatchObject({ stage: "KEEPERS", mode: "READ_ONLY" });
    expect(stageViewPolicy(completed)).toEqual({ mutationsEnabled: false, operationsCorrectionOnly: true });
  });
  it("keeps the prior season and expected version after a failed bootstrap", async () => {
    const fetcher = vi.fn().mockImplementationOnce(() => response({ message: "broken" }, false));
    const client = createApiClient(fetcher as never);
    const activation = createSeasonActivation(client, { season: { id: "old", rowVersion: 4 } } as never);
    await expect(activation.activate("new")).rejects.toThrow("broken");
    expect(activation.current().season).toMatchObject({ id: "old", rowVersion: 4 });
    expect(client.expectedVersion()).toBe(4);
  });

  it("commits only the latest successful rapid season switch", async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise(resolve => { resolveFirst = resolve; });
    const fetcher = vi.fn().mockImplementationOnce(() => first).mockImplementationOnce(() => response({ season: { id: "second", rowVersion: 7 }, legalStage: "DRAFT" }));
    const client = createApiClient(fetcher as never);
    const activation = createSeasonActivation(client);
    const stale = activation.activate("first");
    await activation.activate("second");
    resolveFirst({ ok: true, json: () => Promise.resolve({ season: { id: "first", rowVersion: 2 }, legalStage: "SETUP" }) });
    await stale;
    expect(activation.current().season).toMatchObject({ id: "second", rowVersion: 7 });
    expect(client.expectedVersion()).toBe(7);
  });

  it("does not alter activation when a generic stage loader fails", async () => {
    const fetcher = vi.fn().mockImplementationOnce(() => response({ season: { id: "s", rowVersion: 3 }, legalStage: "AUCTION_1" })).mockImplementationOnce(() => response({ message: "stage failed" }, false));
    const client = createApiClient(fetcher as never);
    const activation = createSeasonActivation(client);
    await activation.activate("s");
    await expect(client.request("/api/stage/failure")).rejects.toThrow("stage failed");
    expect(activation.current().season).toMatchObject({ id: "s", rowVersion: 3 });
    expect(client.expectedVersion()).toBe(3);
  });

  it("retains stable server error codes for inline stage feedback",async()=>{const client=createApiClient(vi.fn(()=>response({message:"Player is unavailable",code:"PLAYER_UNAVAILABLE"},false)) as never);await expect(client.request("/api/catalog/s/search")).rejects.toMatchObject({message:"Player is unavailable",code:"PLAYER_UNAVAILABLE"});});
});
