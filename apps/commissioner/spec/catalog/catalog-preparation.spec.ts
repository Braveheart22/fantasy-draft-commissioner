import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { CatalogPreparationService } from "../../src/application/catalog/catalog-preparation-service.js";
import { openSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";
import { LocalCatalogFileSource } from "../../src/infrastructure/files/local-catalog-file-source.js";

const actor = { subjectId: "local:commissioner", type: "LOCAL_COMMISSIONER", label: "Commissioner", effectiveRole: "COMMISSIONER", context: {} } as const;
const meta = (seasonId: string, key: string, commandType: string, expectedVersion?: number) => ({ actor, seasonId, idempotencyKey: key, commandType, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
async function fresh() { const path = join(await mkdtemp(join(tmpdir(), "commissioner-catalog-preparation-")), "draft.db"); return { path, store: await openSeasonStore(path) }; }

describe("durable catalog preparation", () => {
  it("persists immutable normalized rows and unresolved review state across restart", async () => {
    const { path, store } = await fresh();
    await store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    await store.addCustomPlayer(meta("s", "custom", "ADD_CUSTOM_PLAYER", 0), { id: "eddie", name: "Eddie Gallagher", position: "K", sourceType: "LEAGUE_CUSTOM" });
    const service = new CatalogPreparationService(store);
    const batch = await service.stage(meta("s", "stage", "STAGE_CATALOG", 1), {
      bytes: Buffer.from(JSON.stringify([{ externalId: "provider-eddie", name: "Eddie Gallagher", position: "K" }])), format: "json", sourceNamespace: "manual-2026",
    });
    expect(batch).toMatchObject({ state: "STAGED", rowCount: 1, unresolvedCount: 1 });
    await store.close();

    const reopened = await openSeasonStore(path);
    const persisted = await reopened.catalogPreparation(actor, "s", batch.id);
    expect(persisted.rows[0]).toMatchObject({ name: "Eddie Gallagher", reviewKind: "CUSTOM_COLLISION" });
    expect(persisted.rows[0]).not.toHaveProperty("disposition");
    await expect(reopened.approveCatalog(meta("s", "blocked", "APPROVE_CATALOG", 2), batch.id)).rejects.toThrow(/unresolved/i);
    await reopened.close();
  });

  it("binds approval to durable staged rows and the current season version", async () => {
    const { store } = await fresh();
    await store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    const service = new CatalogPreparationService(store);
    const batch = await service.stage(meta("s", "stage", "STAGE_CATALOG", 0), {
      bytes: Buffer.from(JSON.stringify([{ externalId: "1", name: "Justin Jefferson", position: "WR", nflTeam: "MIN" }])), format: "json", sourceNamespace: "canonical",
    });
    await store.configureTeams(meta("s", "teams", "CONFIGURE_TEAMS", 1), [{ id: "a", displayName: "Alpha", seedOrder: 1 }]);
    await expect(store.approveCatalog(meta("s", "stale", "APPROVE_CATALOG", 2), batch.id)).rejects.toThrow(/stale.*batch/i);
    expect((await store.catalogPlayers(actor, "s")).map(player => player.name)).toEqual([]);
    await store.close();
  });

  it("promotes a resolved review atomically and preserves custom players", async () => {
    const { store } = await fresh();
    await store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    await store.addCustomPlayer(meta("s", "custom", "ADD_CUSTOM_PLAYER", 0), { id: "eddie", name: "Eddie Gallagher", position: "K", sourceType: "LEAGUE_CUSTOM" });
    const service = new CatalogPreparationService(store);
    const batch = await service.stage(meta("s", "stage", "STAGE_CATALOG", 1), {
      bytes: Buffer.from(JSON.stringify([{ externalId: "1", name: "Eddie Gallagher", position: "K" }, { externalId: "2", name: "Justin Jefferson", position: "WR" }])), format: "json", sourceNamespace: "canonical",
    });
    await store.setCatalogDisposition(meta("s", "resolve", "REVIEW_CATALOG", 2), batch.id, 1, { disposition: "KEEP_SEPARATE" });
    const approved = await store.approveCatalog(meta("s", "approve", "APPROVE_CATALOG", 3), batch.id);
    expect(approved).toMatchObject({ promotedCount: 2 });
    const players = await store.catalogPlayers(actor, "s");
    expect(players.filter(player => player.name === "Eddie Gallagher")).toHaveLength(2);
    expect(players.find(player => player.id === "eddie")).toMatchObject({ sourceType: "LEAGUE_CUSTOM", available: true });
    await store.close();
  });

  it("approves the immutable acquired bytes even if the source file changes later", async () => {
    const { path, store } = await fresh();
    await store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    const sourcePath = `${path}.json`;
    await writeFile(sourcePath, JSON.stringify([{ externalId: "1", name: "Original Player", position: "QB" }]));
    const artifact = await new LocalCatalogFileSource(sourcePath, "json", "canonical").acquire();
    await writeFile(sourcePath, JSON.stringify([{ externalId: "1", name: "Swapped Player", position: "QB" }]));
    const batch = await new CatalogPreparationService(store).stage(meta("s", "stage", "STAGE_CATALOG", 0), artifact);
    await store.approveCatalog(meta("s", "approve", "APPROVE_CATALOG", 1), batch.id);
    expect(await store.catalogPlayers(actor, "s")).toEqual([expect.objectContaining({ name: "Original Player" })]);
    await store.close();
  });

  it("audits league selectability and supersedes a referenced custom player without rekeying history", async () => {
    const { store } = await fresh();
    await store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    const service = new CatalogPreparationService(store);
    const batch = await service.stage(meta("s", "stage", "STAGE_CATALOG", 0), { bytes: Buffer.from(JSON.stringify([{ externalId: "nfl", name: "NFL Player", position: "QB" }])), format: "json", sourceNamespace: "canonical" });
    await store.approveCatalog(meta("s", "approve", "APPROVE_CATALOG", 1), batch.id);
    const nfl = (await store.catalogPlayers(actor, "s"))[0]!;
    await store.setLeagueSelectability(meta("s", "disable", "SET_PLAYER_SELECTABILITY", 2), nfl.id, false);
    expect(await store.catalogPlayers(actor, "s", { availability: "LEAGUE_DISABLED" })).toEqual([expect.objectContaining({ id: nfl.id, available: false })]);

    await store.addCustomPlayer(meta("s", "custom", "ADD_CUSTOM_PLAYER", 3), { id: "custom", name: "Custom", position: "K", sourceType: "LEAGUE_CUSTOM" });
    await store.configureTeams(meta("s", "teams", "CONFIGURE_TEAMS", 4), [{ id: "a", displayName: "Alpha", seedOrder: 1 }]);
    await store.setKeeperEligibility(meta("s", "eligible", "SET_KEEPER_ELIGIBILITY", 5), ["custom"]);
    const team = (await store.setupSummary(actor, "s")).teams[0]!;
    await store.selectKeeper(meta("s", "keeper", "SELECT_KEEPER", 6), team.seasonTeamId, "custom");
    expect(await store.reviseCustomPlayer(meta("s", "revise", "REVISE_CUSTOM_PLAYER", 7), "custom", { replacementId: "custom-v2", name: "Custom Revised", position: "K" })).toEqual({ playerId: "custom-v2", superseded: true });
    expect(await store.catalogPlayers(actor, "s")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "custom", reason: "LEAGUE_DISABLED" }),
      expect.objectContaining({ id: "custom-v2", name: "Custom Revised", available: true }),
    ]));
    const audit = await store.auditForSeason(actor, "s");
    expect(audit.map(event => event.commandType)).toEqual(expect.arrayContaining(["SET_PLAYER_SELECTABILITY", "REVISE_CUSTOM_PLAYER"]));
    await store.close();
  });

  it("requires an explicit disposition when a refresh omits a referenced player", async () => {
    const { store } = await fresh();
    await store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    const service = new CatalogPreparationService(store);
    const initial = await service.stage(meta("s", "stage-1", "STAGE_CATALOG", 0), { bytes: Buffer.from(JSON.stringify([{ externalId: "1", name: "Keeper", position: "WR" }])), format: "json", sourceNamespace: "canonical" });
    await store.approveCatalog(meta("s", "approve-1", "APPROVE_CATALOG", 1), initial.id);
    const player = (await store.catalogPlayers(actor, "s"))[0]!;
    await store.configureTeams(meta("s", "teams", "CONFIGURE_TEAMS", 2), [{ id: "a", displayName: "Alpha", seedOrder: 1 }]);
    await store.setKeeperEligibility(meta("s", "eligible", "SET_KEEPER_ELIGIBILITY", 3), [player.id]);
    const team = (await store.setupSummary(actor, "s")).teams[0]!;
    await store.selectKeeper(meta("s", "keeper", "SELECT_KEEPER", 4), team.seasonTeamId, player.id);
    const refresh = await service.stage(meta("s", "stage-2", "STAGE_CATALOG", 5), { bytes: Buffer.from("[]"), format: "json", sourceNamespace: "canonical" });
    expect(refresh).toMatchObject({ rowCount: 0, unresolvedCount: 1, rows: [expect.objectContaining({ operation: "OMIT", reviewKind: "SOURCE_OMISSION" })] });
    await expect(store.approveCatalog(meta("s", "blocked", "APPROVE_CATALOG", 6), refresh.id)).rejects.toThrow(/unresolved/i);
    await store.setCatalogDisposition(meta("s", "keep", "REVIEW_CATALOG", 6), refresh.id, 1, { disposition: "KEEP_ACTIVE" });
    await store.approveCatalog(meta("s", "approve-2", "APPROVE_CATALOG", 7), refresh.id);
    expect(await store.catalogPlayers(actor, "s")).toEqual([expect.objectContaining({ id: player.id, providerActive: true, available: true })]);
    await store.close();
  });

  it("rejects cancelled and expired previews without changing the approved catalog", async () => {
    const cancelledFixture = await fresh();
    await cancelledFixture.store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    const cancelled = await new CatalogPreparationService(cancelledFixture.store).stage(meta("s", "stage", "STAGE_CATALOG", 0), { bytes: Buffer.from(JSON.stringify([{ externalId: "1", name: "Player", position: "QB" }])), format: "json", sourceNamespace: "canonical" });
    await cancelledFixture.store.cancelCatalogPreparation(meta("s", "cancel", "CANCEL_CATALOG", 1), cancelled.id);
    expect(await cancelledFixture.store.catalogPreparation(actor, "s", cancelled.id)).toMatchObject({ state: "CANCELLED" });
    await expect(cancelledFixture.store.approveCatalog(meta("s", "approve", "APPROVE_CATALOG", 2), cancelled.id)).rejects.toThrow(/active.*not found/i);
    await cancelledFixture.store.close();

    const expiredFixture = await fresh();
    await expiredFixture.store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    const expired = await new CatalogPreparationService(expiredFixture.store).stage(meta("s", "stage", "STAGE_CATALOG", 0), { bytes: Buffer.from(JSON.stringify([{ externalId: "1", name: "Player", position: "QB" }])), format: "json", sourceNamespace: "canonical" });
    await expiredFixture.store.close();
    const database = new Database(expiredFixture.path); database.prepare("UPDATE CatalogPreparationBatch SET expiresAt=? WHERE id=?").run(new Date(0).toISOString(), expired.id); database.close();
    const reopened = await openSeasonStore(expiredFixture.path);
    expect(await reopened.catalogPreparation(actor, "s", expired.id)).toMatchObject({ state: "EXPIRED" });
    await expect(reopened.approveCatalog(meta("s", "approve", "APPROVE_CATALOG", 1), expired.id)).rejects.toThrow(/expired/i);
    expect(await reopened.catalogPlayers(actor, "s")).toEqual([]);
    await reopened.close();
  });

  it("stages and promotes 10,000 normalized players with bounded bulk writes", async () => {
    const { path, store } = await fresh();
    await store.execute(meta("s", "create", "CREATE_SEASON"), tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }));
    const content = Buffer.from(JSON.stringify(Array.from({ length: 10_000 }, (_, index) => ({ externalId: String(index), name: `Player ${index}`, position: index % 2 ? "WR" : "RB" }))));
    const service = new CatalogPreparationService(store);
    const stageStarted = performance.now();
    const batch = await service.stage(meta("s", "stage", "STAGE_CATALOG", 0), { bytes: content, format: "json", sourceNamespace: "synthetic" });
    const stageDurationMs = performance.now() - stageStarted;
    const promoteStarted = performance.now();
    const result = await store.approveCatalog(meta("s", "approve", "APPROVE_CATALOG", 1), batch.id);
    const promoteDurationMs = performance.now() - promoteStarted;
    expect(result.promotedCount).toBe(10_000);
    expect(stageDurationMs).toBeLessThan(5_000);
    expect(promoteDurationMs).toBeLessThan(5_000);
    await store.close();
    const database = new Database(path); expect(database.prepare("SELECT count(*) FROM Player WHERE seasonId='s'").pluck().get()).toBe(10_000); database.close();
  });
});
