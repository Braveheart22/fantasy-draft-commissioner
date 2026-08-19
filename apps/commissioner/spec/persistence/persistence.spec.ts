import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabaseCopySafely, openSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";
import { LifecycleState } from "../../src/application/ports/season-repository.js";
import {
  backupArtifactPath,
  fixturePath,
  inspectBaselineTable,
  loadSchema6Manifest,
  sha256,
  sha256File,
} from "../fixtures/persistence/schema-6-fixture.js";

async function databasePath(name = "season.db") {
  return join(await mkdtemp(join(tmpdir(), "commissioner-u2-")), name);
}

const actor = { type: "LOCAL_COMMISSIONER", label: "Commissioner" } as const;

describe("SQLite season persistence", () => {
  it("starts empty, creates a season atomically with audit, and resumes after restart", async () => {
    const path = await databasePath();
    let store = await openSeasonStore(path);
    expect(await store.listSeasons(actor)).toEqual([]);
    const created = await store.execute({ actor, seasonId: "season-1", idempotencyKey: "create-1", commandType: "CREATE_SEASON" }, tx =>
      tx.createSeason({ id: "season-1", leagueId: "league-1", year: 2026, name: "2026", teamCount: 10 }),
    );
    expect(created.state).toBe(LifecycleState.SETUP);
    expect(await store.auditForSeason(actor, "season-1")).toHaveLength(1);
    await store.close();
    store = await openSeasonStore(path);
    expect(await store.getSeason(actor, "season-1")).toMatchObject({ rowVersion: 0, state: LifecycleState.SETUP });
    expect(await store.recoverySummary(actor, "season-1")).toMatchObject({ integrity: "ok", lastCommandType: "CREATE_SEASON" });
    await store.close();
  });

  it("rolls state and audit back together when a command throws", async () => {
    const store = await openSeasonStore(await databasePath());
    await expect(store.execute({ actor, seasonId: "season-x", idempotencyKey: "bad", commandType: "CREATE_SEASON" }, async tx => {
      await tx.createSeason({ id: "season-x", leagueId: "league-x", year: 2026, name: "bad", teamCount: 10 });
      throw new Error("injected");
    })).rejects.toThrow("injected");
    expect(await store.listSeasons(actor)).toEqual([]);
    expect(await store.auditForSeason(actor, "season-x")).toEqual([]);
    await store.close();
  });

  it("deduplicates retries and rejects stale versions and illegal transitions", async () => {
    const store = await openSeasonStore(await databasePath());
    const meta = { actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" };
    const first = await store.execute(meta, tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "S", teamCount: 10 }));
    const retry = await store.execute(meta, () => { throw new Error("must not rerun"); });
    expect(retry).toEqual(first);
    await expect(store.transition({ actor, seasonId: "s", idempotencyKey: "illegal", commandType: "SKIP", expectedVersion: 0 }, LifecycleState.R2_PUBLISHED)).rejects.toThrow("Illegal lifecycle transition");
    await store.transition({ actor, seasonId: "s", idempotencyKey: "lock", commandType: "LOCK_KEEPERS", expectedVersion: 0 }, LifecycleState.KEEPERS_LOCKED);
    await expect(store.transition({ actor, seasonId: "s", idempotencyKey: "stale", commandType: "STALE", expectedVersion: 0 }, LifecycleState.R1_BIDDING)).rejects.toThrow("Stale season version");
    expect(await store.auditForSeason(actor, "s")).toHaveLength(2);
    await store.close();
  });

  it("persists snapshot/checkpoint source lineage and prevents audit mutation", async () => {
    const store = await openSeasonStore(await databasePath());
    await store.execute({ actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "S", teamCount: 8 }));
    const result = await store.execute({ actor, seasonId: "s", idempotencyKey: "checkpoint", commandType: "CHECKPOINT", expectedVersion: 0 }, async tx => {
      const snapshot = await tx.addSnapshot({ id: "snap", seasonId: "s", kind: "SETUP", schemaVersion: 1, payloadJson: "{}", sha256: "hash" });
      return tx.addCheckpoint({ id: "cp", seasonId: "s", kind: "SETUP", seasonVersion: 0, stateSnapshotId: snapshot.id });
    });
    expect(result).toMatchObject({ id: "cp", stateSnapshotId: "snap" });
    await expect(store.attemptAuditMutationForTesting()).rejects.toThrow(/append-only/i);
    await store.close();
  });

  it("copy-migrate-promote keeps originals on failure and rejects newer schemas", async () => {
    const path = await databasePath();
    const store = await openSeasonStore(path); await store.close();
    const original = await readFile(path);
    await expect(migrateDatabaseCopySafely(path, { injectFailure: true })).rejects.toThrow("Injected migration failure");
    expect(await readFile(path)).toEqual(original);
    const raw = new Database(path); raw.prepare("UPDATE SchemaMetadata SET version = 999").run(); raw.close();
    await expect(migrateDatabaseCopySafely(path)).rejects.toThrow("newer schema");
    await writeFile(`${path}.marker`, "original retained");
  });

  it("restarts at every forward lifecycle state", async () => {
    const path = await databasePath();
    let store = await openSeasonStore(path);
    await store.execute({ actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx => tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "S", teamCount: 10 }));
    const states = [LifecycleState.KEEPERS_LOCKED, LifecycleState.R1_BIDDING, LifecycleState.R1_REVIEW, LifecycleState.R1_PUBLISHED, LifecycleState.R2_BIDDING, LifecycleState.R2_REVIEW, LifecycleState.R2_PUBLISHED, LifecycleState.ORDER_FINAL, LifecycleState.CONVENTIONAL_DRAFT, LifecycleState.COMPLETED];
    for (const [index, state] of states.entries()) {
      await store.transition({ actor, seasonId: "s", idempotencyKey: `step-${index}`, commandType: `GO_${state}`, expectedVersion: index }, state);
      await store.close();
      store = await openSeasonStore(path);
      expect(await store.getSeason(actor, "s")).toMatchObject({ state, rowVersion: index + 1 });
    }
    expect(await store.auditForSeason(actor, "s")).toHaveLength(states.length + 1);
    await store.close();
  });

  it("opens the released schema-6 fixture and preserves its relational fingerprints", async () => {
    const manifest = await loadSchema6Manifest();
    expect(manifest).toMatchObject({
      format: "commissioner-schema-6-baseline/v1",
      provenance: { commit: "23c994c", tag: "phase2-baseline", schemaVersion: 6 },
      integrity: "ok",
      foreignKeyViolations: [],
    });
    expect(manifest.wholeDatabaseHashPolicy).toMatch(/informational-only/);
    expect(manifest.lifecycleResumes).toEqual(Object.values(LifecycleState));
    expect(manifest.correctionResumeDefaults).toEqual({
      PICK: "CONVENTIONAL_DRAFT",
      AUCTION_REOPEN: "R1_BIDDING",
      ROUND_1: "KEEPERS_LOCKED",
      ROUND_2: "R1_PUBLISHED",
      DRAFT_ORDER: "R2_PUBLISHED",
      KEEPER: "SETUP",
    });

    const path = await databasePath("released-schema-6.sqlite");
    await copyFile(fixturePath(manifest.databaseFile), path);
    const store = await openSeasonStore(path);
    expect(await store.getSeason(actor, "season-schema-6-clean")).toMatchObject({ state: LifecycleState.SETUP, rowVersion: 0 });
    expect(await store.getSeason(actor, "season-schema-6-completed")).toMatchObject({ state: LifecycleState.COMPLETED, rowVersion: 47 });
    await store.close();

    const database = new Database(path, { readonly: true, fileMustExist: true });
    expect(database.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(database.pragma("foreign_key_check")).toEqual([]);
    for (const table of manifest.tables) {
      const inspected = inspectBaselineTable(database, table);
      expect(inspected.preservedColumns, `${table.name} columns`).toEqual(table.columns);
      expect(inspected.foreignKeys, `${table.name} foreign keys`).toEqual(expect.arrayContaining(table.foreignKeys));
      expect(inspected.rowCount, `${table.name} row count`).toBe(table.rowCount);
      expect(inspected.relationalSha256, `${table.name} relational fingerprint`).toBe(table.relationalSha256);
    }
    for (const expected of manifest.defaultClasses) {
      const table = manifest.tables.find(item => item.name === expected.table)!;
      expect(table.columns.find(column => column.name === expected.column)?.defaultValue).toBe(expected.defaultValue);
    }

    const snapshots = database.prepare("SELECT id,kind,payloadJson,sha256 FROM FrozenSnapshot ORDER BY id").all() as Array<{ id: string; kind: string; payloadJson: string; sha256: string }>;
    expect(snapshots.map(row => ({ id: row.id, kind: row.kind, sha256: row.sha256, payloadSha256: sha256(row.payloadJson) }))).toEqual(manifest.immutableHashes.frozenSnapshots);
    const attempts = database.prepare("SELECT id,roundId,attemptNumber,inputJson,inputHash,outputJson,outputHash FROM AuctionAttempt ORDER BY roundId,attemptNumber").all() as Array<{ id: string; roundId: string; attemptNumber: number; inputJson: string; inputHash: string; outputJson: string; outputHash: string }>;
    expect(attempts.map(row => ({ id: row.id, roundId: row.roundId, attemptNumber: row.attemptNumber, inputHash: row.inputHash, inputJsonSha256: sha256(row.inputJson), outputHash: row.outputHash, outputJsonSha256: sha256(row.outputJson) }))).toEqual(manifest.immutableHashes.auctionAttempts);
    expect(database.prepare("SELECT id,orderSnapshotId,orderHash FROM ConventionalDraft ORDER BY id").all()).toEqual(manifest.immutableHashes.conventionalDraft);
    expect(database.prepare("SELECT id,trigger,sha256,schemaVersion,seasonVersion,dependencyCutHash FROM BackupRecord ORDER BY id").all()).toEqual(manifest.immutableHashes.backupRecords);
    expect(database.prepare("SELECT id,jsonSha256,csvSha256,schemaVersion FROM ExportRecord ORDER BY id").all()).toEqual(manifest.immutableHashes.exportRecords);
    const semanticQueries: Array<[string, string]> = [
      ["customPlayers", "SELECT count(*) FROM Player WHERE custom=1"],
      ["importedPlayers", "SELECT count(*) FROM Player WHERE custom=0"],
      ["availablePlayers", "SELECT count(*) FROM Player WHERE available=1"],
      ["unavailablePlayers", "SELECT count(*) FROM Player WHERE available=0"],
      ["ownedPlayers", "SELECT count(DISTINCT playerId) FROM RosterAssignment WHERE supersededAt IS NULL"],
      ["unownedPlayers", "SELECT count(*) FROM Player p WHERE NOT EXISTS (SELECT 1 FROM RosterAssignment r WHERE r.playerId=p.id AND r.supersededAt IS NULL)"],
      ["auctionRounds", "SELECT count(*) FROM AuctionRound"],
      ["draftOrderEntries", "SELECT count(*) FROM DraftOrderEntry"],
      ["draftPicks", "SELECT count(*) FROM DraftPick"],
      ["auditEvents", "SELECT count(*) FROM AuditEvent"],
      ["checkpoints", "SELECT count(*) FROM Checkpoint"],
      ["backupRecords", "SELECT count(*) FROM BackupRecord"],
      ["correctionActions", "SELECT count(*) FROM CorrectionAction"],
      ["exports", "SELECT count(*) FROM ExportRecord"],
    ];
    const semanticCounts = Object.fromEntries(semanticQueries.map(([key, sql]) => [key, Number(database.prepare(sql).pluck().get())]));
    expect(semanticCounts).toEqual(manifest.semanticCounts);
    const correction = database.prepare("SELECT impactJson,confirmedAt FROM CorrectionAction").get() as { impactJson: string; confirmedAt: string | null };
    expect(JSON.parse(correction.impactJson)).toMatchObject({ resumeState: "CONVENTIONAL_DRAFT" });
    expect(correction.confirmedAt).toBeNull();
    database.close();

    for (const record of manifest.immutableHashes.backupRecords) expect(await sha256File(backupArtifactPath(record.id))).toBe(record.sha256);
    expect(await sha256File(fixturePath(manifest.immutableHashes.exportedFiles.json.file))).toBe(manifest.immutableHashes.exportedFiles.json.sha256);
    expect(await sha256File(fixturePath(manifest.immutableHashes.exportedFiles.csv.file))).toBe(manifest.immutableHashes.exportedFiles.csv.sha256);
    expect(manifest.semanticCounts).toMatchObject({
      customPlayers: 1,
      importedPlayers: 30,
      availablePlayers: 3,
      unavailablePlayers: 28,
      ownedPlayers: 28,
      unownedPlayers: 3,
      auctionRounds: 2,
      draftOrderEntries: 2,
      draftPicks: 25,
      auditEvents: 51,
      checkpoints: 1,
      backupRecords: 9,
      correctionActions: 1,
      exports: 1,
    });
  });

  it("fails closed when the released fixture claims a newer schema", async () => {
    const manifest = await loadSchema6Manifest();
    const path = await databasePath("newer-released-schema.sqlite");
    await copyFile(fixturePath(manifest.databaseFile), path);
    const database = new Database(path);
    database.prepare("UPDATE SchemaMetadata SET version=999 WHERE singleton=1").run();
    database.close();
    await expect(openSeasonStore(path)).rejects.toThrow(/newer schema/i);
  });
});
