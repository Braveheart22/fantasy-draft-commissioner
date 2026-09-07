import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const defaultMigrationsDirectory = fileURLToPath(new URL("../prisma/postgres/migrations/", import.meta.url));

export async function migratePostgres(connectionString, migrationsDirectory = defaultMigrationsDirectory) {
  if (!connectionString) throw new Error("COMMISSIONER_POSTGRES_URL is required");
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [7331003]);
    await client.query('CREATE TABLE IF NOT EXISTS public."HostedMigration" ("name" text PRIMARY KEY, "sha256" text NOT NULL, "appliedAt" timestamptz NOT NULL DEFAULT now())');
    const entries = (await readdir(migrationsDirectory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    for (const name of entries) {
      const sql = await readFile(resolve(migrationsDirectory, name, "migration.sql"), "utf8");
      const sha256 = createHash("sha256").update(sql).digest("hex");
      const applied = await client.query('SELECT "sha256" FROM public."HostedMigration" WHERE "name" = $1', [name]);
      if (applied.rowCount) {
        if (applied.rows[0].sha256 !== sha256) throw new Error(`Applied hosted migration ${name} no longer matches its recorded SHA-256`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query('INSERT INTO public."HostedMigration" ("name", "sha256") VALUES ($1, $2)', [name, sha256]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [7331003]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await migratePostgres(process.env.COMMISSIONER_POSTGRES_URL, process.argv[2] ? resolve(process.argv[2]) : undefined);
}
