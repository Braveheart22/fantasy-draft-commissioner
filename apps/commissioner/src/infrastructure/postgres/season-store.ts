import { PrismaPg } from "@prisma/adapter-pg";
import type { CommitNotificationPort } from "../../application/ports/commit-notification.js";
import { PrismaClient as PostgresPrismaClient } from "../../generated/postgres/client.js";
import type { PrismaClient as SqlitePrismaClient } from "../../generated/prisma/client.js";
import { PrismaSeasonStore } from "../prisma/season-store.js";

export interface PostgresSeasonStoreOptions {
  readonly maxTransactionAttempts?: number;
}

export async function openPostgresSeasonStore(
  connectionString: string,
  commitNotifications?: CommitNotificationPort,
  options: PostgresSeasonStoreOptions = {},
): Promise<PrismaSeasonStore> {
  if (!connectionString.trim()) throw new Error("PostgreSQL connection string is required");
  const url = new URL(connectionString);
  const schema = url.searchParams.get("schema") ?? "public";
  const adapter = new PrismaPg({ connectionString }, { schema });
  const prisma = new PostgresPrismaClient({ adapter });
  await prisma.$connect();
  return new PrismaSeasonStore(prisma as unknown as SqlitePrismaClient, commitNotifications, {
    dialect: "postgres",
    ...(options.maxTransactionAttempts === undefined ? {} : { maxTransactionAttempts: options.maxTransactionAttempts }),
  });
}

export { PrismaSeasonStore };
