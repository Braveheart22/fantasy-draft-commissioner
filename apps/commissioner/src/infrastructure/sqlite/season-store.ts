import { randomUUID } from "node:crypto";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { assertLifecycleTransition } from "../../application/commands/lifecycle.js";
import type { ActorDescriptor, CommandMetadata, SeasonRecord, SeasonRepository, SeasonTransaction } from "../../application/ports/season-repository.js";
import { LifecycleState } from "../../application/ports/season-repository.js";
import { PrismaClient } from "../../generated/prisma/client.js";
import { migrateDatabaseInPlace } from "./migrations.js";
export { migrateDatabaseCopySafely } from "./migrations.js";

function mapSeason(row: { id: string; leagueId: string; year: number; name: string; state: string; teamCount: number; rowVersion: number; active: boolean }): SeasonRecord {
  return {
    id: row.id,
    leagueId: row.leagueId,
    year: row.year,
    name: row.name,
    state: row.state as LifecycleState,
    teamCount: row.teamCount,
    rowVersion: row.rowVersion,
    active: row.active,
  };
}

export class PrismaSeasonStore implements SeasonRepository {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly prisma: PrismaClient) {}

  execute<T>(metadata: CommandMetadata, operation: (transaction: SeasonTransaction) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(() => this.executeNow(metadata, operation));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async executeNow<T>(metadata: CommandMetadata, operation: (transaction: SeasonTransaction) => T | Promise<T>): Promise<T> {
    const duplicate = await this.prisma.auditEvent.findUnique({ where: { seasonId_actorType_idempotencyKey: { seasonId: metadata.seasonId, actorType: metadata.actor.type, idempotencyKey: metadata.idempotencyKey } }, select: { resultJson: true } });
    if (duplicate?.resultJson != null) return JSON.parse(duplicate.resultJson) as T;
    const auditId = randomUUID();
    const correlationId = metadata.correlationId ?? randomUUID();
    return this.prisma.$transaction(async database => {
      await database.$executeRawUnsafe("PRAGMA defer_foreign_keys = ON");
      const beforeRow = await database.season.findUnique({ where: { id: metadata.seasonId } });
      const before = beforeRow ? mapSeason(beforeRow) : undefined;
      if (metadata.expectedVersion !== undefined && before?.rowVersion !== metadata.expectedVersion) throw new Error(`Stale season version: expected ${metadata.expectedVersion}, found ${before?.rowVersion ?? "missing"}`);
      const getRequiredSeason = async (seasonId: string): Promise<SeasonRecord> => {
        const season = await database.season.findUnique({ where: { id: seasonId } });
        if (!season) throw new Error(`Season not found: ${seasonId}`);
        return mapSeason(season);
      };
      const tx: SeasonTransaction = {
        createSeason: async input => {
          await database.league.upsert({ where: { id: input.leagueId }, create: { id: input.leagueId, name: input.leagueId }, update: {} });
          return mapSeason(await database.season.create({ data: { ...input, state: LifecycleState.SETUP, active: false } }));
        },
        transition: async (seasonId, expectedVersion, target) => {
          const season = await getRequiredSeason(seasonId);
          if (season.rowVersion !== expectedVersion) throw new Error(`Stale season version: expected ${expectedVersion}, found ${season.rowVersion}`);
          assertLifecycleTransition(season.state, target);
          const changed = await database.season.updateMany({ where: { id: seasonId, rowVersion: expectedVersion }, data: { state: target, rowVersion: { increment: 1 } } });
          if (changed.count !== 1) throw new Error("Stale season version");
          return getRequiredSeason(seasonId);
        },
        addSnapshot: async input => {
          const snapshot = await database.frozenSnapshot.create({ data: { ...input, sourceAuditEventId: auditId } });
          return { id: snapshot.id, seasonId: snapshot.seasonId, kind: snapshot.kind, schemaVersion: snapshot.schemaVersion, payloadJson: snapshot.payloadJson, sha256: snapshot.sha256, sourceAuditEventId: snapshot.sourceAuditEventId };
        },
        addCheckpoint: async input => {
          const checkpoint = await database.checkpoint.create({ data: { ...input, sourceAuditEventId: auditId } });
          return { id: checkpoint.id, seasonId: checkpoint.seasonId, kind: checkpoint.kind, seasonVersion: checkpoint.seasonVersion, stateSnapshotId: checkpoint.stateSnapshotId, sourceAuditEventId: checkpoint.sourceAuditEventId };
        },
      };
      const result = await operation(tx);
      const afterRow = await database.season.findUnique({ where: { id: metadata.seasonId } });
      const after = afterRow ? mapSeason(afterRow) : undefined;
      const latest = await database.auditEvent.aggregate({ where: { seasonId: metadata.seasonId }, _max: { sequence: true } });
      await database.auditEvent.create({ data: { id: auditId, seasonId: metadata.seasonId, sequence: (latest._max.sequence ?? 0) + 1, actorType: metadata.actor.type, actorLabel: metadata.actor.label, commandType: metadata.commandType, correlationId, idempotencyKey: metadata.idempotencyKey, reason: metadata.reason ?? null, beforeJson: before ? JSON.stringify(before) : null, afterJson: after ? JSON.stringify(after) : null, resultJson: JSON.stringify(result) } });
      return result;
    });
  }

  transition(metadata: CommandMetadata & { expectedVersion: number }, target: LifecycleState): Promise<SeasonRecord> { return this.execute(metadata, tx => tx.transition(metadata.seasonId, metadata.expectedVersion, target)); }
  async getSeason(_actor: ActorDescriptor, seasonId: string): Promise<SeasonRecord | undefined> { const row = await this.prisma.season.findUnique({ where: { id: seasonId } }); return row ? mapSeason(row) : undefined; }
  async listSeasons(_actor: ActorDescriptor): Promise<SeasonRecord[]> { return (await this.prisma.season.findMany({ orderBy: [{ year: "asc" }, { id: "asc" }] })).map(mapSeason); }
  async auditForSeason(_actor: ActorDescriptor, seasonId: string): Promise<Record<string, unknown>[]> { return this.prisma.auditEvent.findMany({ where: { seasonId }, orderBy: { sequence: "asc" } }); }
  async recoverySummary(actor: ActorDescriptor, seasonId: string) { const [season, last, integrity] = await Promise.all([this.getSeason(actor, seasonId), this.prisma.auditEvent.findFirst({ where: { seasonId }, orderBy: { sequence: "desc" } }), this.prisma.$queryRawUnsafe<Array<{ integrity_check: string }>>("PRAGMA integrity_check")]); return { integrity: integrity[0]?.integrity_check, season, lastCommandType: last?.commandType, lastCommittedAt: last?.createdAt }; }
  async attemptAuditMutationForTesting(): Promise<void> { await this.prisma.$executeRawUnsafe("UPDATE AuditEvent SET commandType = 'tampered'"); }
  async close(): Promise<void> { await this.prisma.$disconnect(); }
}

export async function openSeasonStore(path: string): Promise<PrismaSeasonStore> {
  migrateDatabaseInPlace(path);
  const adapter = new PrismaBetterSqlite3({ url: path }, { timestampFormat: "iso8601" });
  const prisma = new PrismaClient({ adapter });
  await prisma.$connect();
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = DELETE");
  await prisma.$executeRawUnsafe("PRAGMA synchronous = FULL");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
  return new PrismaSeasonStore(prisma);
}
