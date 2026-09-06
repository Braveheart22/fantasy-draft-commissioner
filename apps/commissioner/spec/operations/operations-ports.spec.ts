import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { CheckpointService } from "../../src/application/backups/checkpoint-service.js";
import { ManualBackupService } from "../../src/application/backups/manual-backup-service.js";
import { CorrectionService } from "../../src/application/corrections/correction-service.js";
import { ExportService } from "../../src/application/exports/export-service.js";
import { RecoveryService } from "../../src/application/recovery/recovery-service.js";

const metadata = {
  actor: { subjectId: "local:test", type: "LOCAL_COMMISSIONER", label: "Test", effectiveRole: "COMMISSIONER", context: {} },
  seasonId: "season", commandType: "LOCK", idempotencyKey: "lock", expectedVersion: 4,
} as const;

describe("hosted-capable operations ports", () => {
  it("keeps SQLite and filesystem dependencies outside application services", async () => {
    for (const path of [
      "backups/checkpoint-service.ts", "backups/manual-backup-service.ts",
      "corrections/correction-service.ts", "exports/export-service.ts", "recovery/recovery-service.ts",
    ]) {
      const source = await readFile(new URL(`../../src/application/${path}`, import.meta.url), "utf8");
      expect(source).not.toContain("better-sqlite3");
      expect(source).not.toContain("databasePath");
      expect(source).not.toContain("infrastructure/");
    }
  });

  it("delegates checkpoint and recovery behavior through replaceable ports", async () => {
    const before = vi.fn(async () => undefined);
    await new CheckpointService({ before }).before(metadata, "PRE_LOCK");
    expect(before).toHaveBeenCalledWith(metadata, "PRE_LOCK");
    const summary = { integrity: "ok", schemaVersion: 10, compatible: true, interruptedOperations: [] };
    await expect(new RecoveryService({ summary: async () => summary }).summary(metadata.actor)).resolves.toBe(summary);
  });

  it("keeps actor-bearing command metadata intact across operation facades", async () => {
    const backupReceipt = { backupId: "backup", path: "backup.db", manifestPath: "backup.json", sha256: "hash", manifest: {} };
    const create = vi.fn(async () => backupReceipt);
    const verify = vi.fn(async () => backupReceipt);
    await new ManualBackupService({ create, verify } as never).create(metadata, "backups", "MANUAL");
    expect(create).toHaveBeenCalledWith(metadata, "backups", "MANUAL");
    await new ManualBackupService({ create, verify } as never).verify(metadata.actor, "backup.json");
    expect(verify).toHaveBeenCalledWith(metadata.actor, "backup.json");

    const previewResult = { id: "preview", seasonId: "season", seasonVersion: 4 };
    const preview = vi.fn(async () => previewResult);
    const confirm = vi.fn(async () => previewResult);
    const corrections = new CorrectionService({ preview, confirm } as never);
    await corrections.preview(metadata, "PICK", "pick");
    expect(preview).toHaveBeenCalledWith("season", "PICK", "pick", metadata);
    await corrections.confirm(metadata, "preview", { cutHash: "cut", backupHash: "backup", confirmation: "CONFIRM ROLLBACK", reason: "Wrong pick" });
    expect(confirm).toHaveBeenCalledWith("preview", expect.objectContaining({ seasonId: "season", expectedVersion: 4, metadata }));

    const exported = { id: "export", backupId: "backup", jsonPath: "out.json", jsonSha256: "json", csvPath: "out.csv", csvSha256: "csv" };
    const exportOperation = vi.fn(async () => exported);
    const rules = { limits: {}, flexEligible: [], flexCapacity: 0 };
    await new ExportService({ export: exportOperation }).export(metadata, "exports", rules);
    expect(exportOperation).toHaveBeenCalledWith("season", "exports", rules, metadata);
  });
});
