import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { CatalogPreparationService } from "../../src/application/catalog/catalog-preparation-service.js";
import { openSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";
import { registerCatalogRoutes } from "../../src/routes/catalog/catalog-routes.js";

const actor = { type: "LOCAL_COMMISSIONER", label: "Commissioner" } as const;

describe("catalog preparation HTTP delivery", () => {
  it("requires command metadata and serves the SQLite-backed review after staging", async () => {
    const store = await openSeasonStore(join(await mkdtemp(join(tmpdir(), "commissioner-catalog-routes-")), "draft.db"));
    await store.execute({ actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    const server = Fastify();
    await registerCatalogRoutes(server, new CatalogPreparationService(store), store);
    const payload = { sourceNamespace: "canonical", format: "json" as const, content: JSON.stringify([{ externalId: "1", name: "Player", position: "QB" }]) };
    expect((await server.inject({ method: "POST", url: "/api/catalog/s/preparations", payload })).statusCode).toBe(400);
    const staged = await server.inject({ method: "POST", url: "/api/catalog/s/preparations", headers: { "idempotency-key": "stage", "x-expected-season-version": "0" }, payload });
    expect(staged.statusCode).toBe(200);
    expect(staged.json()).toMatchObject({ rowCount: 1, unresolvedCount: 0, state: "STAGED" });
    const read = await server.inject({ method: "GET", url: `/api/catalog/s/preparations/${staged.json().id}` });
    expect(read.json()).toMatchObject({ sourceHash: staged.json().sourceHash, rows: [{ name: "Player" }] });
    const approved = await server.inject({ method: "POST", url: `/api/catalog/s/preparations/${staged.json().id}/approve`, headers: { "idempotency-key": "approve", "x-expected-season-version": "1" }, payload: {} });
    expect(approved).toMatchObject({ statusCode: 200 });
    expect(approved.json()).toMatchObject({ promotedCount: 1, normalizedHash: staged.json().normalizedHash });
    await server.close(); await store.close();
  });

  it("rejects malformed and over-limit input without creating a staged batch", async () => {
    const store = await openSeasonStore(join(await mkdtemp(join(tmpdir(), "commissioner-catalog-routes-")), "draft.db"));
    await store.execute({ actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    const server = Fastify();
    await registerCatalogRoutes(server, new CatalogPreparationService(store, { maxFieldLength: 8 }), store);
    const rejected = await server.inject({ method: "POST", url: "/api/catalog/s/preparations", headers: { "idempotency-key": "stage", "x-expected-season-version": "0" }, payload: { sourceNamespace: "canonical", format: "json", content: JSON.stringify([{ externalId: "1", name: "This is too long", position: "QB" }]) } });
    expect(rejected.statusCode).toBe(400);
    expect(await store.auditForSeason(actor, "s")).toHaveLength(1);
    await server.close(); await store.close();
  });
});
