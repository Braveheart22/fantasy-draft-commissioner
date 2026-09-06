import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { PricingService } from "../../src/application/pricing/pricing-service.js";
import { openSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";
import { registerPricingRoutes } from "../../src/routes/pricing/pricing-routes.js";

const actor = { subjectId: "local:commissioner", type: "LOCAL_COMMISSIONER", label: "Commissioner", effectiveRole: "COMMISSIONER", context: {} } as const;

describe("pricing HTTP delivery", () => {
  it("requires command metadata, rejects malformed input atomically, and serves approved provenance", async () => {
    const store = await openSeasonStore(join(await mkdtemp(join(tmpdir(), "commissioner-pricing-routes-")), "draft.db"));
    await store.execute({ actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    await store.addCustomPlayer({ actor, seasonId: "s", idempotencyKey: "player", commandType: "ADD_CUSTOM_PLAYER", expectedVersion: 0 }, { id: "eddie", name: "Eddie Gallagher", position: "K", sourceType: "LEAGUE_CUSTOM" });
    const server = Fastify();
    await registerPricingRoutes(server, new PricingService(store), store);
    const payload = { sourceLabel: "League sheet", format: "json" as const, content: JSON.stringify([{ name: "Eddie Gallagher", position: "K", minimumBid: 4 }]) };

    expect((await server.inject({ method: "POST", url: "/api/pricing/s/preparations", payload })).statusCode).toBe(400);
    const auditCount = (await store.auditForSeason(actor, "s")).length;
    const malformed = await server.inject({ method: "POST", url: "/api/pricing/s/preparations", headers: { "idempotency-key": "bad", "x-expected-season-version": "1" }, payload: { ...payload, content: "not json" } });
    expect(malformed.statusCode).toBe(400);
    expect(await store.auditForSeason(actor, "s")).toHaveLength(auditCount);

    const staged = await server.inject({ method: "POST", url: "/api/pricing/s/preparations", headers: { "idempotency-key": "stage", "x-expected-season-version": "1" }, payload });
    expect(staged).toMatchObject({ statusCode: 200 });
    expect(staged.json()).toMatchObject({ rowCount: 1, unresolvedCount: 1, state: "STAGED" });
    const reviewed = await server.inject({ method: "PUT", url: `/api/pricing/s/preparations/${staged.json().id}/rows/1`, headers: { "idempotency-key": "review", "x-expected-season-version": "2" }, payload: { resolutionPlayerId: "eddie" } });
    expect(reviewed.json()).toMatchObject({ unresolvedCount: 0 });
    const approved = await server.inject({ method: "POST", url: `/api/pricing/s/preparations/${staged.json().id}/approve`, headers: { "idempotency-key": "approve", "x-expected-season-version": "3" }, payload: {} });
    expect(approved.json()).toMatchObject({ assignedCount: 1 });
    expect((await server.inject({ method: "GET", url: "/api/pricing/s" })).json()).toMatchObject({ players: [{ playerId: "eddie", minimumBid: 4, source: "LIST", sourceLabel: "League sheet" }], preflight: { pricedCount: 1, missingCount: 0, unresolvedBatchCount: 0 } });
    await server.close(); await store.close();
  });
});
