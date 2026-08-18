import { createHash, randomUUID } from "node:crypto";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { assertLifecycleTransition } from "../../application/commands/lifecycle.js";
import type { ActorDescriptor, CommandMetadata, SeasonRecord, SeasonRepository, SeasonTransaction } from "../../application/ports/season-repository.js";
import { LifecycleState } from "../../application/ports/season-repository.js";
import { PLAYER_POSITIONS, type ImportPreview, type ImportRow, type PlayerInput, type SetupRepository, type SetupSummary, type TeamInput } from "../../application/setup/setup-repository.js";
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

function positiveDollar(value: unknown, label: string): number {
  const amount = typeof value === "string" && value !== "" ? Number(value) : value;
  if (!Number.isInteger(amount) || Number(amount) <= 0) throw new Error(`${label} must be a positive whole-dollar amount`);
  return Number(amount);
}

function parseRows(content: string, format: "csv" | "json"): Array<Record<string, unknown>> {
  if (format === "json") {
    const value: unknown = JSON.parse(content);
    if (!Array.isArray(value)) throw new Error("Canonical JSON import must be an array");
    return value as Array<Record<string, unknown>>;
  }
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = (lines.shift() ?? "").split(",").map(value => value.trim());
  return lines.map(line => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value.trim()])));
}

export class PrismaSeasonStore implements SeasonRepository, SetupRepository {
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

  private async assertSetup(seasonId: string) {
    const season = await this.prisma.season.findUnique({ where: { id: seasonId } });
    if (!season) throw new Error(`Season not found: ${seasonId}`);
    if (season.state !== LifecycleState.SETUP) throw new Error("Season setup is locked");
    return season;
  }

  private setupCommand<T>(metadata: CommandMetadata, work: (database: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], auditId: string) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const duplicate = await this.prisma.auditEvent.findUnique({ where: { seasonId_actorType_idempotencyKey: { seasonId: metadata.seasonId, actorType: metadata.actor.type, idempotencyKey: metadata.idempotencyKey } }, select: { resultJson: true } });
      if (duplicate) return (duplicate.resultJson ? JSON.parse(duplicate.resultJson) : undefined) as T;
      const correlationId = metadata.correlationId ?? randomUUID();
      return this.prisma.$transaction(async database => {
        await database.$executeRawUnsafe("PRAGMA defer_foreign_keys = ON");
        const auditId = randomUUID();
        const beforeRow = await database.season.findUniqueOrThrow({ where: { id: metadata.seasonId } });
        if (metadata.expectedVersion !== undefined && beforeRow.rowVersion !== metadata.expectedVersion) throw new Error(`Stale season version: expected ${metadata.expectedVersion}, found ${beforeRow.rowVersion}`);
        const result = await work(database as never, auditId);
        const afterRow = await database.season.findUniqueOrThrow({ where: { id: metadata.seasonId } });
        const latest = await database.auditEvent.aggregate({ where: { seasonId: metadata.seasonId }, _max: { sequence: true } });
        await database.auditEvent.create({ data: { id: auditId, seasonId: metadata.seasonId, sequence: (latest._max.sequence ?? 0) + 1, actorType: metadata.actor.type, actorLabel: metadata.actor.label, commandType: metadata.commandType, correlationId, idempotencyKey: metadata.idempotencyKey, reason: metadata.reason ?? null, beforeJson: JSON.stringify(mapSeason(beforeRow)), afterJson: JSON.stringify(mapSeason(afterRow)), resultJson: JSON.stringify(result ?? null) } });
        return result;
      });
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async configureTeams(metadata: CommandMetadata, teams: TeamInput[]): Promise<void> {
    await this.assertSetup(metadata.seasonId);
    const season = await this.prisma.season.findUniqueOrThrow({ where: { id: metadata.seasonId } });
    if (teams.length !== season.teamCount) throw new Error(`Expected ${season.teamCount} participating teams`);
    if (new Set(teams.map(team => team.id)).size !== teams.length || new Set(teams.map(team => team.displayName.trim().toLowerCase())).size !== teams.length) throw new Error("Duplicate teams are not allowed");
    if (new Set(teams.map(team => team.seedOrder)).size !== teams.length || teams.some(team => team.seedOrder < 1)) throw new Error("Team order must be unique and positive");
    await this.setupCommand(metadata, async database => {
      await database.seasonTeam.deleteMany({ where: { seasonId: metadata.seasonId } });
      for (const team of teams) {
        if (!team.displayName.trim()) throw new Error("Team display name is required");
        await database.team.upsert({ where: { id: team.id }, create: { id: team.id, leagueId: season.leagueId, franchiseName: team.displayName.trim() }, update: { franchiseName: team.displayName.trim() } });
        await database.seasonTeam.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, teamId: team.id, displayName: team.displayName.trim(), seedOrder: team.seedOrder } });
      }
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
    });
  }

  async addCustomPlayer(metadata: CommandMetadata, player: PlayerInput): Promise<void> {
    await this.assertSetup(metadata.seasonId);
    if (player.sourceType !== "LEAGUE_CUSTOM" || player.externalId || player.sourceNamespace) throw new Error("Custom players cannot have an external identity");
    if (!PLAYER_POSITIONS.includes(player.position)) throw new Error(`Unknown position: ${player.position}`);
    await this.setupCommand(metadata, async database => {
      const collision = await database.player.findFirst({ where: { seasonId: metadata.seasonId, name: player.name } });
      if (collision) throw new Error("Player identity collision requires review");
      await database.player.create({ data: { ...player, seasonId: metadata.seasonId, custom: true, explicitMinimumBid: player.explicitMinimumBid ?? null } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
    });
  }

  async previewImport(_actor: ActorDescriptor, seasonId: string, namespace: string, content: string, format: "csv" | "json"): Promise<ImportPreview> {
    await this.assertSetup(seasonId);
    if (!namespace.trim()) throw new Error("Source namespace is required");
    const hash = createHash("sha256").update(content).digest("hex");
    const parsed = parseRows(content, format);
    const rows: ImportRow[] = [];
    const errors: string[] = [];
    const reviews: ImportPreview["reviews"] = [];
    const seen = new Set<string>();
    const existing = await this.prisma.player.findMany({ where: { seasonId } });
    parsed.forEach((raw, index) => {
      const rowNumber = index + 1;
      const externalId = String(raw.externalId ?? "").trim();
      const name = String(raw.name ?? "").trim();
      const position = String(raw.position ?? "").toUpperCase();
      if (!externalId || !name || !PLAYER_POSITIONS.includes(position as never)) { errors.push(`Row ${rowNumber}: externalId, name, and known position are required`); return; }
      if (seen.has(externalId)) { errors.push(`Row ${rowNumber}: duplicate externalId ${externalId}`); return; }
      seen.add(externalId);
      let explicitMinimumBid: number | undefined;
      try { if (raw.minimumBid !== undefined && raw.minimumBid !== "") explicitMinimumBid = positiveDollar(raw.minimumBid, `Row ${rowNumber} minimumBid`); } catch (error) { errors.push((error as Error).message); return; }
      const customCollision = existing.find(player => player.custom && player.name.toLowerCase() === name.toLowerCase());
      if (customCollision) reviews.push({ kind: "CUSTOM_COLLISION", row: rowNumber, message: `${name} matches protected custom player ${customCollision.id}` });
      const identity = existing.find(player => player.sourceNamespace === namespace && player.externalId === externalId);
      if (identity && identity.name !== name) reviews.push({ kind: "IDENTITY_COLLISION", row: rowNumber, message: `${externalId} changed name from ${identity.name} to ${name}` });
      const changedId = existing.find(player => player.sourceNamespace === namespace && player.name.toLowerCase() === name.toLowerCase() && player.externalId !== externalId);
      if (changedId) reviews.push({ kind: "EXTERNAL_ID_CHANGE", row: rowNumber, message: `${name} changed external ID from ${changedId.externalId} to ${externalId}` });
      rows.push({ externalId, name, position: position as ImportRow["position"], ...(explicitMinimumBid === undefined ? {} : { explicitMinimumBid }) });
    });
    const duplicate = await this.prisma.playerImportBatch.findUnique({ where: { seasonId_sourceNamespace_sha256: { seasonId, sourceNamespace: namespace, sha256: hash } } });
    return { hash, rows, errors, reviews, noOp: Boolean(duplicate) };
  }

  async commitImport(metadata: CommandMetadata, namespace: string, format: "csv" | "json", preview: ImportPreview): Promise<{ noOp: boolean; batchId?: string }> {
    await this.assertSetup(metadata.seasonId);
    if (preview.errors.length) throw new Error("Import has validation errors");
    if (preview.reviews.length && !preview.reviewsApproved) throw new Error("Import requires explicit identity review");
    if (preview.noOp) return { noOp: true };
    return this.setupCommand(metadata, async database => {
      const prior = await database.playerImportBatch.findFirst({ where: { seasonId: metadata.seasonId, sourceNamespace: namespace, supersededAt: null }, orderBy: { createdAt: "desc" } });
      const batchId = randomUUID();
      if (prior) await database.playerImportBatch.update({ where: { id: prior.id }, data: { supersededAt: new Date() } });
      if (prior) await database.player.updateMany({ where: { seasonId: metadata.seasonId, activeImportBatchId: prior.id, custom: false }, data: { available: false } });
      await database.playerImportBatch.create({ data: { id: batchId, seasonId: metadata.seasonId, sourceNamespace: namespace, format, sha256: preview.hash, rowCount: preview.rows.length, supersedesId: prior?.id ?? null } });
      for (const row of preview.rows) {
        const current = await database.player.findFirst({ where: { seasonId: metadata.seasonId, sourceType: "NFL", sourceNamespace: namespace, externalId: row.externalId } });
        const data = { name: row.name, position: row.position, explicitMinimumBid: row.explicitMinimumBid ?? null, activeImportBatchId: batchId, available: true };
        if (current) await database.player.update({ where: { id: current.id }, data });
        else await database.player.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, sourceType: "NFL", sourceNamespace: namespace, externalId: row.externalId, custom: false, ...data } });
      }
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
      return { noOp: false, batchId };
    });
  }

  async setPriceFloors(metadata: CommandMetadata, floors: Record<string, number>): Promise<void> {
    await this.assertSetup(metadata.seasonId);
    for (const [position, floor] of Object.entries(floors)) { if (!PLAYER_POSITIONS.includes(position as never)) throw new Error(`Unknown position: ${position}`); positiveDollar(floor, `${position} minimum`); }
    await this.setupCommand(metadata, async database => {
      await database.positionPriceFloor.deleteMany({ where: { seasonId: metadata.seasonId } });
      for (const [position, minimumBid] of Object.entries(floors)) await database.positionPriceFloor.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, position, minimumBid } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
    });
  }

  async selectKeeper(metadata: CommandMetadata, seasonTeamId: string, playerId?: string): Promise<void> {
    await this.assertSetup(metadata.seasonId);
    await this.setupCommand(metadata, async database => {
      const team = await database.seasonTeam.findFirst({ where: { id: seasonTeamId, seasonId: metadata.seasonId } });
      if (!team) throw new Error("Season team not found");
      await database.keeperSelection.deleteMany({ where: { seasonTeamId } });
      if (playerId) {
        const player = await database.player.findFirst({ where: { id: playerId, seasonId: metadata.seasonId, available: true, keeperEligible: true } });
        if (!player) throw new Error("Keeper player is unavailable");
        await database.keeperSelection.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, seasonTeamId, playerId, cost: 50, startingBudget: 300 } });
      }
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
    });
  }

  async setKeeperEligibility(metadata: CommandMetadata, playerIds: string[]): Promise<void> {
    await this.assertSetup(metadata.seasonId);
    if (new Set(playerIds).size !== playerIds.length) throw new Error("Duplicate keeper eligibility player");
    await this.setupCommand(metadata, async database => {
      const count = await database.player.count({ where: { seasonId: metadata.seasonId, id: { in: playerIds } } });
      if (count !== playerIds.length) throw new Error("Keeper eligibility contains an unknown player");
      await database.player.updateMany({ where: { seasonId: metadata.seasonId }, data: { keeperEligible: false } });
      await database.player.updateMany({ where: { seasonId: metadata.seasonId, id: { in: playerIds } }, data: { keeperEligible: true } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
    });
  }

  async lockKeepers(metadata: CommandMetadata, rosterCapacity: number): Promise<SetupSummary> {
    await this.assertSetup(metadata.seasonId);
    if (!Number.isInteger(rosterCapacity) || rosterCapacity < 1) throw new Error("Roster capacity must be positive");
    const summary = await this.setupSummary(metadata.actor, metadata.seasonId);
    if (summary.teams.length !== summary.season.teamCount) throw new Error("Participating team count is incomplete");
    for (const player of summary.players) if (player.minimumBid === undefined) throw new Error(`Missing positional floor for ${player.position}`);
    if (summary.teams.some(team => team.keeperPlayerId && rosterCapacity < 1)) throw new Error("Keeper exceeds roster capacity");
    await this.setupCommand({ ...metadata, expectedVersion: metadata.expectedVersion ?? summary.season.rowVersion }, async (database, auditId) => {
      const keeperIds = new Set(summary.teams.flatMap(team => team.keeperPlayerId ? [team.keeperPlayerId] : []));
      const payloadJson = JSON.stringify({ teams: summary.teams, players: summary.players.map(player => ({ id: player.id, available: keeperIds.has(player.id) ? false : player.available, minimumBid: player.minimumBid })) });
      const snapshotId = randomUUID();
      await database.frozenSnapshot.create({ data: { id: snapshotId, seasonId: metadata.seasonId, kind: "KEEPER_LOCK", schemaVersion: 1, payloadJson, sha256: createHash("sha256").update(payloadJson).digest("hex"), sourceAuditEventId: auditId } });
      await database.checkpoint.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, kind: "KEEPER_LOCK", seasonVersion: summary.season.rowVersion + 1, stateSnapshotId: snapshotId, sourceAuditEventId: auditId } });
      await database.player.updateMany({ where: { seasonId: metadata.seasonId, keeper: { isNot: null } }, data: { available: false } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { state: LifecycleState.KEEPERS_LOCKED, rowVersion: { increment: 1 } } });
    });
    return this.setupSummary(metadata.actor, metadata.seasonId);
  }

  async setupSummary(actor: ActorDescriptor, seasonId: string): Promise<SetupSummary> {
    const season = await this.getSeason(actor, seasonId); if (!season) throw new Error(`Season not found: ${seasonId}`);
    const [teams, players, floors] = await Promise.all([
      this.prisma.seasonTeam.findMany({ where: { seasonId }, include: { keeper: true }, orderBy: { seedOrder: "asc" } }),
      this.prisma.player.findMany({ where: { seasonId }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
      this.prisma.positionPriceFloor.findMany({ where: { seasonId } }),
    ]);
    const floorMap = Object.fromEntries(floors.map(floor => [floor.position, floor.minimumBid]));
    return { season, teams: teams.map(team => ({ id: team.teamId, seasonTeamId: team.id, displayName: team.displayName, seedOrder: team.seedOrder, ...(team.keeper ? { keeperPlayerId: team.keeper.playerId } : {}), startingBudget: team.keeper ? 300 : 350 })), players: players.map(player => { const minimumBid = player.explicitMinimumBid ?? floorMap[player.position]; return ({ id: player.id, name: player.name, position: player.position as PlayerInput["position"], sourceType: player.sourceType as PlayerInput["sourceType"], ...(player.sourceNamespace ? { sourceNamespace: player.sourceNamespace } : {}), ...(player.externalId ? { externalId: player.externalId } : {}), ...(player.explicitMinimumBid == null ? {} : { explicitMinimumBid: player.explicitMinimumBid }), ...(minimumBid === undefined ? {} : { minimumBid }), available: player.available }); }), floors: floorMap };
  }
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
