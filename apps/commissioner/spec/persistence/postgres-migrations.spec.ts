import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

const run = promisify(execFile);
const configuredConnectionString = process.env.COMMISSIONER_POSTGRES_SHADOW_URL;
if (!configuredConnectionString) throw new Error("COMMISSIONER_POSTGRES_SHADOW_URL is required for PostgreSQL migration specs");
const connectionString: string = configuredConnectionString;
const temporaryDirectories: string[] = [];

async function resetShadow() {
  const url = new URL(connectionString);
  if (!url.pathname.endsWith("fantasy_draft_commissioner_phase3_shadow")) throw new Error("Refusing to reset a non-shadow PostgreSQL database");
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public AUTHORIZATION fdc_phase3_dev");
  } finally {
    await pool.end();
  }
}

async function migrate(directory: string) {
  return run(process.execPath, ["scripts/migrate-postgres.mjs", directory], {
    cwd: process.cwd(),
    env: { ...process.env, COMMISSIONER_POSTGRES_URL: connectionString },
  });
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.map(directory => rm(directory, { recursive: true, force: true })));
});

describe("PostgreSQL hosted migrations", () => {
  it("is repeatable and rolls a failed migration back before a corrected roll-forward", async () => {
    await resetShadow();
    const directory = await mkdtemp(join(tmpdir(), "commissioner-postgres-migrations-"));
    temporaryDirectories.push(directory);
    await cp(resolve("prisma/postgres/migrations/0001_hosted_baseline"), join(directory, "0001_hosted_baseline"), { recursive: true });
    const failingDirectory = join(directory, "0002_recovery_probe");
    await mkdir(failingDirectory);
    await writeFile(join(failingDirectory, "migration.sql"), 'CREATE TABLE public."MigrationRecoveryProbe" (id integer PRIMARY KEY); SELECT 1 / 0;');

    await expect(migrate(directory)).rejects.toThrow();
    const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 });
    try {
      const failed = await pool.query<{ table_exists: boolean; receipt_exists: boolean }>(`SELECT
        to_regclass('public."MigrationRecoveryProbe"') IS NOT NULL AS table_exists,
        EXISTS (SELECT 1 FROM public."HostedMigration" WHERE "name"='0002_recovery_probe') AS receipt_exists`);
      expect(failed.rows[0]).toEqual({ table_exists: false, receipt_exists: false });

      await writeFile(join(failingDirectory, "migration.sql"), 'CREATE TABLE public."MigrationRecoveryProbe" (id integer PRIMARY KEY);');
      await migrate(directory);
      await migrate(directory);
      const recovered = await pool.query<{ table_exists: boolean; receipts: number }>(`SELECT
        to_regclass('public."MigrationRecoveryProbe"') IS NOT NULL AS table_exists,
        (SELECT count(*)::int FROM public."HostedMigration") AS receipts`);
      expect(recovered.rows[0]).toEqual({ table_exists: true, receipts: 2 });

      await writeFile(join(failingDirectory, "migration.sql"), 'CREATE TABLE public."MigrationRecoveryProbe" (id bigint PRIMARY KEY);');
      await expect(migrate(directory)).rejects.toThrow(/no longer matches its recorded SHA-256/);
    } finally {
      await pool.end();
    }
  });
});
