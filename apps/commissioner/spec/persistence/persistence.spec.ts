import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabaseCopySafely, openSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";
import { LifecycleState } from "../../src/application/ports/season-repository.js";

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
});
