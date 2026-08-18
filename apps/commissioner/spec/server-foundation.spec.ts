import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDurableDatabase, stagedRestore, verifiedBackup } from "../src/server/sqlite-maintenance.js";
import { resolveDataDirectory, startCommissionerServer } from "../src/server/startup.js";

describe("commissioner server foundation", () => {
  it("uses the configured data directory and otherwise a platform-local default", () => {
    expect(resolveDataDirectory({ LEAGUE_DRAFT_DATA_DIR: "C:\\draft-data" }, "win32", "C:\\Local")).toBe("C:\\draft-data");
    expect(resolveDataDirectory({}, "win32", "C:\\Local")).toBe("C:\\Local\\LeagueDraft");
  });

  it("binds loopback, reports port collisions, and stops safely", async () => {
    const first = await startCommissionerServer({ port: 0, dataDirectory: await mkdtemp(join(tmpdir(), "league-draft-")) });
    expect(first.address.host).toBe("127.0.0.1");
    await expect(startCommissionerServer({ port: first.address.port, dataDirectory: await mkdtemp(join(tmpdir(), "league-draft-")) }))
      .rejects.toMatchObject({ code: "EADDRINUSE" });
    await first.stop();
    await expect(first.stop()).resolves.toBeUndefined();
  });

  it("enforces durability pragmas and backs up/restores through staged files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "league-draft-sqlite-"));
    const databasePath = join(directory, "draft.sqlite");
    const database = openDurableDatabase(databasePath);
    database.exec("CREATE TABLE marker (value TEXT NOT NULL); INSERT INTO marker VALUES ('before')");
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("journal_mode", { simple: true })).toBe("delete");
    expect(database.pragma("synchronous", { simple: true })).toBe(2);
    expect(database.pragma("busy_timeout", { simple: true })).toBeGreaterThan(0);
    const backupPath = join(directory, "backup.sqlite");
    await writeFile(backupPath, "stale backup");
    const receipt = await verifiedBackup(database, backupPath);
    expect(receipt.sha256).toHaveLength(64);
    database.exec("UPDATE marker SET value = 'after'");
    database.close();
    await stagedRestore(databasePath, backupPath);
    const restored = openDurableDatabase(databasePath);
    expect(restored.prepare("SELECT value FROM marker").pluck().get()).toBe("before");
    restored.close();
    expect((await readFile(backupPath)).byteLength).toBeGreaterThan(0);
  });
});
