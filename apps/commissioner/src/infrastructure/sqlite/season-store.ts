import { existsSync } from "node:fs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import type { CommitNotificationPort } from "../../application/ports/commit-notification.js";
import { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaSeasonStore } from "../prisma/season-store.js";
import { databaseNeedsMigration, migrateDatabaseCopySafely, migrateDatabaseInPlace } from "./migrations.js";

export { PrismaSeasonStore, migrateDatabaseCopySafely };

export async function openSeasonStore(path: string, commitNotifications?: CommitNotificationPort): Promise<PrismaSeasonStore> {
  if (existsSync(path) && databaseNeedsMigration(path)) await migrateDatabaseCopySafely(path);
  else migrateDatabaseInPlace(path);
  const adapter = new PrismaBetterSqlite3({ url: path }, { timestampFormat: "iso8601" });
  const prisma = new PrismaClient({ adapter });
  await prisma.$connect();
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = DELETE");
  await prisma.$executeRawUnsafe("PRAGMA synchronous = FULL");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
  return new PrismaSeasonStore(prisma, commitNotifications);
}
