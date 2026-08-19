import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { assertLifecycleTransition } from "../../application/commands/lifecycle.js";
import type { AuctionBidDraft, AuctionRepository, AuctionRoundNumber, AuctionRoundSummary, TieDecisionInput } from "../../application/auction/auction-repository.js";
import type { AuctionEngineResult, CommissionerAuctionInput } from "../../application/ports/auction-engine.js";
import type { ActorDescriptor, CommandMetadata, SeasonRecord, SeasonRepository, SeasonTransaction } from "../../application/ports/season-repository.js";
import { LifecycleState } from "../../application/ports/season-repository.js";
import { PLAYER_POSITIONS, type ImportPreview, type ImportRow, type PlayerInput, type SetupRepository, type SetupSummary, type TeamInput } from "../../application/setup/setup-repository.js";
import type { DraftOrderDecision, DraftOrderRepository, DraftOrderSummary } from "../../application/draft-order/draft-order-repository.js";
import type { ConventionalDraftRepository, DraftPickInput } from "../../application/conventional-draft/conventional-draft-repository.js";
import { canAddPlayerThroughPhase1, validateRosterThroughPhase1 } from "../../integrations/roster-validator-adapter.js";
import { PrismaClient } from "../../generated/prisma/client.js";
import { databaseNeedsMigration, migrateDatabaseCopySafely, migrateDatabaseInPlace } from "./migrations.js";
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

const ENGINE_CONTRACT_VERSION = "phase1/1";
const hashJson = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function groupBalances<T extends { remainingBudget: number }>(items: T[]): Map<number, T[]> { const groups = new Map<number, T[]>(); for (const item of items) groups.set(item.remainingBudget, [...(groups.get(item.remainingBudget) ?? []), item]); return groups; }

export class PrismaSeasonStore implements SeasonRepository, SetupRepository, AuctionRepository, DraftOrderRepository, ConventionalDraftRepository {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly prisma: PrismaClient) {}
  async seasonVersion(seasonId: string): Promise<number> { return (await this.prisma.season.findUniqueOrThrow({ where: { id: seasonId }, select: { rowVersion: true } })).rowVersion; }

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
      for (const team of summary.teams) if (team.keeperPlayerId) {
        const keeper = await database.keeperSelection.findUniqueOrThrow({ where: { seasonTeamId: team.seasonTeamId } });
        await database.rosterAssignment.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, seasonTeamId: team.seasonTeamId, playerId: team.keeperPlayerId, acquisitionSource: "KEEPER", cost: 50, sourceEntityId: keeper.id } });
      }
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

  async openRound(metadata: CommandMetadata, roundNumber: AuctionRoundNumber): Promise<AuctionRoundSummary> {
    const expected = roundNumber === 1 ? LifecycleState.KEEPERS_LOCKED : LifecycleState.R1_PUBLISHED;
    await this.setupCommand(metadata, async database => {
      const season = await database.season.findUniqueOrThrow({ where: { id: metadata.seasonId } });
      const existing = await database.auctionRound.findFirst({ where: { seasonId: metadata.seasonId, roundNumber, supersededAt: null } });
      if (existing) return;
      if (season.state !== expected) throw new Error(`Round ${roundNumber} cannot open from ${season.state}`);
      const teams = await database.seasonTeam.findMany({ where: { seasonId: metadata.seasonId, active: true }, include: { keeper: true }, orderBy: { seedOrder: "asc" } });
      const roundId = randomUUID();
      await database.auctionRound.create({ data: { id: roundId, seasonId: metadata.seasonId, roundNumber, status: "BIDDING" } });
      for (const team of teams) {
        const previous = roundNumber === 2 ? await database.teamAuctionBalance.findUniqueOrThrow({ where: { seasonId_seasonTeamId_roundNumber: { seasonId: metadata.seasonId, seasonTeamId: team.id, roundNumber: 1 } } }) : undefined;
        const startingBudget = roundNumber === 1 ? (team.keeper ? 300 : 350) : 150 + previous!.remainingBudget;
        await database.teamAuctionBalance.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, seasonTeamId: team.id, roundNumber, startingBudget, spent: 0, remainingBudget: startingBudget } });
        await database.auctionSubmission.create({ data: { id: randomUUID(), roundId, seasonTeamId: team.id, status: "DRAFT", bidsJson: "[]", bidCount: 0 } });
      }
      await database.season.update({ where: { id: metadata.seasonId }, data: { state: roundNumber === 1 ? LifecycleState.R1_BIDDING : LifecycleState.R2_BIDDING, rowVersion: { increment: 1 } } });
    });
    return this.summary(metadata.actor, metadata.seasonId, roundNumber);
  }

  async saveSubmission(metadata: CommandMetadata, roundNumber: AuctionRoundNumber, seasonTeamId: string, bids: AuctionBidDraft[], finalize: boolean, confirmZero: boolean): Promise<void> {
    await this.setupCommand(metadata, async database => {
      const round = await database.auctionRound.findFirstOrThrow({ where: { seasonId: metadata.seasonId, roundNumber, supersededAt: null } });
      if (round.status !== "BIDDING") throw new Error("Locked auction input is immutable");
      const submission = await database.auctionSubmission.findUniqueOrThrow({ where: { roundId_seasonTeamId: { roundId: round.id, seasonTeamId } } });
      const team = await database.seasonTeam.findUniqueOrThrow({ where: { id: seasonTeamId } });
      if (team.seasonId !== metadata.seasonId) throw new Error("Team does not belong to season");
      const seen = new Set<string>();
      for (const bid of bids) {
        if (seen.has(bid.playerId)) throw new Error("A team cannot bid on the same player twice"); seen.add(bid.playerId);
        const player = await database.player.findFirst({ where: { id: bid.playerId, seasonId: metadata.seasonId, available: true } });
        if (!player) throw new Error(`Player is unavailable: ${bid.playerId}`);
      }
      const encoded = bids.map((bid, index) => ({ bidId: `${submission.id}:${index + 1}`, priority: (index + 1) as 1 | 2 | 3, ...bid }));
      await database.auctionSubmission.update({ where: { id: submission.id }, data: { bidsJson: JSON.stringify(encoded), bidCount: bids.length, status: finalize ? "FINAL" : "DRAFT", zeroConfirmed: bids.length === 0 && confirmZero } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
    });
  }

  async lockRound(metadata: CommandMetadata, roundNumber: AuctionRoundNumber, rosterRules: CommissionerAuctionInput["rosterRules"]): Promise<CommissionerAuctionInput> {
    return this.setupCommand(metadata, async (database, auditId) => {
      const round = await database.auctionRound.findFirstOrThrow({ where: { seasonId: metadata.seasonId, roundNumber, supersededAt: null } });
      if (round.status !== "BIDDING") throw new Error("Round is not open for locking");
      const submissions = await database.auctionSubmission.findMany({ where: { roundId: round.id } });
      if (submissions.some(item => item.status !== "FINAL" || (item.bidCount === 0 && !item.zeroConfirmed))) throw new Error("Every team must finalize its submission; zero bids require confirmation");
      const input = await this.buildAuctionInput(database, metadata.seasonId, roundNumber, rosterRules, []);
      const payloadJson = JSON.stringify(input); const sha256 = hashJson(input); const snapshotId = randomUUID();
      await database.frozenSnapshot.create({ data: { id: snapshotId, seasonId: metadata.seasonId, kind: `AUCTION_R${roundNumber}_INPUT`, schemaVersion: 1, payloadJson, sha256, sourceAuditEventId: auditId } });
      await database.auctionRound.update({ where: { id: round.id }, data: { status: "LOCKED", inputSnapshotId: snapshotId, inputHash: sha256, contractVersion: ENGINE_CONTRACT_VERSION } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
      return input;
    });
  }

  private async buildAuctionInput(database: any, seasonId: string, roundNumber: AuctionRoundNumber, rosterRules: CommissionerAuctionInput["rosterRules"], tiePrecedence: CommissionerAuctionInput["tiePrecedence"]): Promise<CommissionerAuctionInput> {
    const round = await database.auctionRound.findFirstOrThrow({ where: { seasonId, roundNumber, supersededAt: null } });
    const [teams, players, floors, submissions, balances, assignments] = await Promise.all([
      database.seasonTeam.findMany({ where: { seasonId, active: true }, orderBy: { seedOrder: "asc" } }), database.player.findMany({ where: { seasonId } }), database.positionPriceFloor.findMany({ where: { seasonId } }), database.auctionSubmission.findMany({ where: { roundId: round.id } }), database.teamAuctionBalance.findMany({ where: { seasonId, roundNumber } }), database.rosterAssignment.findMany({ where: { seasonId, supersededAt: null } }),
    ]);
    const floorMap = Object.fromEntries(floors.map((f: any) => [f.position, f.minimumBid])); const balanceMap = new Map(balances.map((b: any) => [b.seasonTeamId, b.startingBudget])); const submissionMap = new Map(submissions.map((s: any) => [s.seasonTeamId, s])); const assignmentsByTeam = new Map<string, string[]>();
    for (const assignment of assignments) assignmentsByTeam.set(assignment.seasonTeamId, [...(assignmentsByTeam.get(assignment.seasonTeamId) ?? []), assignment.playerId]);
    return { teams: teams.map((team: any) => ({ teamId: team.teamId, startingBudget: balanceMap.get(team.id) as number, startingPlayerIds: assignmentsByTeam.get(team.id) ?? [] })), players: players.map((p: any) => ({ playerId: p.id, position: p.position, minimumBid: p.explicitMinimumBid ?? floorMap[p.position], available: p.available })), bids: teams.flatMap((team: any) => JSON.parse((submissionMap.get(team.id) as any).bidsJson).map((bid: any) => ({ ...bid, teamId: team.teamId }))), rosterRules, tiePrecedence };
  }

  async frozenInput(_actor: ActorDescriptor, seasonId: string, roundNumber: AuctionRoundNumber): Promise<CommissionerAuctionInput> {
    const round = await this.prisma.auctionRound.findFirstOrThrow({ where: { seasonId, roundNumber, supersededAt: null } }); if (!round.inputSnapshotId) throw new Error("Round has no frozen input"); const snapshot = await this.prisma.frozenSnapshot.findUniqueOrThrow({ where: { id: round.inputSnapshotId } }); return JSON.parse(snapshot.payloadJson);
  }

  async recordAttempt(metadata: CommandMetadata, roundNumber: AuctionRoundNumber, input: CommissionerAuctionInput, result: AuctionEngineResult): Promise<void> {
    await this.setupCommand(metadata, async database => {
      const round = await database.auctionRound.findFirstOrThrow({ where: { seasonId: metadata.seasonId, roundNumber, supersededAt: null } });
      if (!round.inputHash) throw new Error("Round has no frozen input");
      const base = await database.frozenSnapshot.findUniqueOrThrow({ where: { id: round.inputSnapshotId! } }); const frozen = JSON.parse(base.payloadJson); const expected = { ...frozen, tiePrecedence: input.tiePrecedence };
      if (hashJson(expected) !== hashJson(input)) throw new Error("Resolution input differs from the frozen input and recorded decisions");
      const attemptNumber = await database.auctionAttempt.count({ where: { roundId: round.id } }) + 1; const outputHash = hashJson(result);
      await database.auctionAttempt.create({ data: { id: randomUUID(), roundId: round.id, attemptNumber, inputJson: JSON.stringify(input), inputHash: hashJson(input), outputJson: JSON.stringify(result), outputHash, eliminationsJson: JSON.stringify(result.eliminations), traceJson: JSON.stringify(result.trace), status: result.status, contractVersion: ENGINE_CONTRACT_VERSION } });
      await database.auctionRound.update({ where: { id: round.id }, data: { status: result.status === "RESOLVED" ? "REVIEW" : "TIE_PAUSED" } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { state: result.status === "RESOLVED" ? (roundNumber === 1 ? LifecycleState.R1_REVIEW : LifecycleState.R2_REVIEW) : (roundNumber === 1 ? LifecycleState.R1_TIE_PAUSED : LifecycleState.R2_TIE_PAUSED), rowVersion: { increment: 1 } } });
    });
  }

  async recordTieDecision(metadata: CommandMetadata, roundNumber: AuctionRoundNumber, decision: TieDecisionInput): Promise<CommissionerAuctionInput> {
    return this.setupCommand(metadata, async database => {
      const round = await database.auctionRound.findFirstOrThrow({ where: { seasonId: metadata.seasonId, roundNumber, supersededAt: null } }); if (round.status !== "TIE_PAUSED") throw new Error("Round is not paused for a tie");
      const last = await database.auctionAttempt.findFirstOrThrow({ where: { roundId: round.id }, orderBy: { attemptNumber: "desc" } }); const result = JSON.parse(last.outputJson) as AuctionEngineResult; const tie = result.unresolvedTies.find(item => item.key === decision.tieKey);
      if (!tie || tie.playerId !== decision.playerId || tie.amount !== decision.amount || JSON.stringify([...tie.teamIds].sort()) !== JSON.stringify([...decision.participantTeamIds].sort()) || !tie.teamIds.includes(decision.preferredTeamId)) throw new Error("Tie decision does not match an unresolved tie");
      if (!decision.method.trim() || !decision.decidedAt) throw new Error("External method and timestamp are required");
      await database.auctionTieDecision.create({ data: { id: randomUUID(), roundId: round.id, tieKey: decision.tieKey, playerId: decision.playerId, amount: decision.amount, participantTeamIdsJson: JSON.stringify(decision.participantTeamIds), preferredTeamId: decision.preferredTeamId, method: decision.method, note: decision.note ?? null, decidedAt: new Date(decision.decidedAt) } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
      const base = await database.frozenSnapshot.findUniqueOrThrow({ where: { id: round.inputSnapshotId! } }); const input = JSON.parse(base.payloadJson) as CommissionerAuctionInput; const decisions = await database.auctionTieDecision.findMany({ where: { roundId: round.id, supersededAt: null }, orderBy: { decidedAt: "asc" } });
      return { ...input, tiePrecedence: decisions.map((d: any) => ({ playerId: d.playerId, amount: d.amount, participantTeamIds: JSON.parse(d.participantTeamIdsJson), preferredTeamId: d.preferredTeamId })) };
    });
  }

  async publish(metadata: CommandMetadata, roundNumber: AuctionRoundNumber): Promise<void> {
    await this.setupCommand(metadata, async database => {
      const round = await database.auctionRound.findFirstOrThrow({ where: { seasonId: metadata.seasonId, roundNumber, supersededAt: null } }); if (round.status === "PUBLISHED") return; if (round.status !== "REVIEW") throw new Error("Only a resolved round may be published");
      const attempt = await database.auctionAttempt.findFirstOrThrow({ where: { roundId: round.id, status: "RESOLVED", supersededAt: null }, orderBy: { attemptNumber: "desc" } }); const result = JSON.parse(attempt.outputJson) as AuctionEngineResult; const teams = await database.seasonTeam.findMany({ where: { seasonId: metadata.seasonId } }); const byTeamId = new Map(teams.map((t: any) => [t.teamId, t.id]));
      for (const award of result.awards) { const seasonTeamId = byTeamId.get(award.teamId); if (!seasonTeamId) throw new Error(`Unknown award team ${award.teamId}`); await database.auctionAward.create({ data: { id: randomUUID(), roundId: round.id, seasonTeamId, playerId: award.playerId, amount: award.amount, bidId: award.bidId, sourceAttemptId: attempt.id } }); await database.rosterAssignment.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, seasonTeamId, playerId: award.playerId, acquisitionSource: "AUCTION", auctionRound: roundNumber, cost: award.amount, sourceEntityId: attempt.id } }); await database.player.update({ where: { id: award.playerId }, data: { available: false } }); }
      for (const teamResult of result.teamResults) { const seasonTeamId = byTeamId.get(teamResult.teamId)!; await database.teamAuctionBalance.update({ where: { seasonId_seasonTeamId_roundNumber: { seasonId: metadata.seasonId, seasonTeamId, roundNumber } }, data: { spent: teamResult.spent, remainingBudget: teamResult.remainingBudget } }); }
      await database.auctionRound.update({ where: { id: round.id }, data: { status: "PUBLISHED", publishedAt: new Date() } }); await database.season.update({ where: { id: metadata.seasonId }, data: { state: roundNumber === 1 ? LifecycleState.R1_PUBLISHED : LifecycleState.R2_PUBLISHED, rowVersion: { increment: 1 } } });
    });
  }

  async reopen(metadata: CommandMetadata, roundNumber: AuctionRoundNumber): Promise<void> { await this.setupCommand(metadata, async database => { const round = await database.auctionRound.findFirstOrThrow({ where: { seasonId: metadata.seasonId, roundNumber, supersededAt: null } }); if (round.status === "PUBLISHED") throw new Error("Published rounds require upstream correction rollback"); await database.auctionAttempt.updateMany({ where: { roundId: round.id, supersededAt: null }, data: { supersededAt: new Date() } }); await database.auctionTieDecision.updateMany({ where: { roundId: round.id, supersededAt: null }, data: { supersededAt: new Date() } }); await database.auctionRound.update({ where: { id: round.id }, data: { status: "BIDDING", inputSnapshotId: null, inputHash: null, contractVersion: null } }); await database.auctionSubmission.updateMany({ where: { roundId: round.id }, data: { status: "DRAFT" } }); await database.season.update({ where: { id: metadata.seasonId }, data: { state: roundNumber === 1 ? LifecycleState.R1_BIDDING : LifecycleState.R2_BIDDING, rowVersion: { increment: 1 } } }); }); }

  async calculate(metadata: CommandMetadata): Promise<DraftOrderSummary> {
    await this.setupCommand(metadata, async (database, auditId) => {
      const season = await database.season.findUniqueOrThrow({ where: { id: metadata.seasonId } });
      if (season.state !== LifecycleState.R2_PUBLISHED) throw new Error("Draft order requires committed Round 2 results");
      const existingDraft = await database.conventionalDraft.findUnique({ where: { seasonId: metadata.seasonId } });
      if (existingDraft && existingDraft.status !== "RESET") return;
      const teams = await database.seasonTeam.findMany({ where: { seasonId: metadata.seasonId, active: true } });
      const balances = await database.teamAuctionBalance.findMany({ where: { seasonId: metadata.seasonId, roundNumber: 2 } });
      if (balances.length !== teams.length) throw new Error("Every team requires a committed Round 2 balance");
      const draftId = existingDraft?.id ?? randomUUID();
      const groups = groupBalances(balances);
      const hasTies = [...groups.values()].some(group => group.length > 1);
      if (existingDraft) await database.conventionalDraft.update({ where: { id: draftId }, data: { status: hasTies ? "TIE_PAUSED" : "FINAL", completedAt: null } });
      else await database.conventionalDraft.create({ data: { id: draftId, seasonId: metadata.seasonId, status: hasTies ? "TIE_PAUSED" : "FINAL", contractVersion: "fixed-order/1" } });
      if (!hasTies) {
        const sorted = [...balances].sort((a, b) => b.remainingBudget - a.remainingBudget);
        for (const [index, balance] of sorted.entries()) await database.draftOrderEntry.create({ data: { id: randomUUID(), conventionalDraftId: draftId, orderPosition: index + 1, seasonTeamId: balance.seasonTeamId, remainingBalance: balance.remainingBudget } });
        const payload = sorted.map(item => ({ seasonTeamId: item.seasonTeamId, remainingBalance: item.remainingBudget })); const snapshotId = randomUUID(); const sha256 = hashJson(payload);
        await database.frozenSnapshot.create({ data: { id: snapshotId, seasonId: metadata.seasonId, kind: "DRAFT_ORDER", schemaVersion: 1, payloadJson: JSON.stringify(payload), sha256, sourceAuditEventId: auditId } });
        await database.conventionalDraft.update({ where: { id: draftId }, data: { orderSnapshotId: snapshotId, orderHash: sha256 } });
      }
      await database.season.update({ where: { id: metadata.seasonId }, data: { state: hasTies ? LifecycleState.ORDER_TIE_PAUSED : LifecycleState.ORDER_FINAL, rowVersion: { increment: 1 } } });
    });
    return this.draftSummary(metadata.actor, metadata.seasonId);
  }

  async recordDraftOrderTieDecision(metadata: CommandMetadata, decision: DraftOrderDecision): Promise<DraftOrderSummary> {
    await this.setupCommand(metadata, async database => {
      const draft = await database.conventionalDraft.findUniqueOrThrow({ where: { seasonId: metadata.seasonId } });
      if (draft.status !== "TIE_PAUSED") throw new Error("Draft order is not awaiting tie precedence");
      const balances = await database.teamAuctionBalance.findMany({ where: { seasonId: metadata.seasonId, roundNumber: 2, remainingBudget: decision.balance } });
      const expected = balances.map(item => item.seasonTeamId).sort();
      if (expected.length < 2 || JSON.stringify([...decision.participantTeamIds].sort()) !== JSON.stringify(expected)) throw new Error("Tie participants do not match the committed balance group");
      if (decision.precedenceTeamIds.length !== expected.length || new Set(decision.precedenceTeamIds).size !== expected.length || JSON.stringify([...decision.precedenceTeamIds].sort()) !== JSON.stringify(expected)) throw new Error("Tie precedence must contain every tied team exactly once");
      if (!decision.method.trim() || !decision.decidedAt) throw new Error("External method and timestamp are required");
      await database.draftOrderTieDecision.create({ data: { id: randomUUID(), conventionalDraftId: draft.id, balance: decision.balance, participantTeamIdsJson: JSON.stringify(decision.participantTeamIds), precedenceTeamIdsJson: JSON.stringify(decision.precedenceTeamIds), method: decision.method, note: decision.note ?? null, decidedAt: new Date(decision.decidedAt) } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
    });
    return this.draftSummary(metadata.actor, metadata.seasonId);
  }

  async finalize(metadata: CommandMetadata): Promise<DraftOrderSummary> {
    await this.setupCommand(metadata, async (database, auditId) => {
      const draft = await database.conventionalDraft.findUniqueOrThrow({ where: { seasonId: metadata.seasonId } });
      if (draft.status === "FINAL" || draft.status === "IN_PROGRESS" || draft.status === "COMPLETED") return;
      const balances = await database.teamAuctionBalance.findMany({ where: { seasonId: metadata.seasonId, roundNumber: 2 } });
      const decisions = await database.draftOrderTieDecision.findMany({ where: { conventionalDraftId: draft.id } });
      const decisionMap = new Map(decisions.map(item => [item.balance, JSON.parse(item.precedenceTeamIdsJson) as string[]]));
      const groups = [...groupBalances(balances)].sort((a, b) => b[0] - a[0]); const ordered: typeof balances = [];
      for (const [balance, group] of groups) { if (group.length === 1) ordered.push(group[0]!); else { const precedence = decisionMap.get(balance); if (!precedence) throw new Error(`Missing external precedence for tied balance ${balance}`); const byId = new Map(group.map(item => [item.seasonTeamId, item])); ordered.push(...precedence.map(id => byId.get(id)!)); } }
      for (const [index, balance] of ordered.entries()) await database.draftOrderEntry.create({ data: { id: randomUUID(), conventionalDraftId: draft.id, orderPosition: index + 1, seasonTeamId: balance.seasonTeamId, remainingBalance: balance.remainingBudget } });
      const payload = ordered.map(item => ({ seasonTeamId: item.seasonTeamId, remainingBalance: item.remainingBudget })); const snapshotId = randomUUID(); const sha256 = hashJson(payload);
      await database.frozenSnapshot.create({ data: { id: snapshotId, seasonId: metadata.seasonId, kind: "DRAFT_ORDER", schemaVersion: 1, payloadJson: JSON.stringify(payload), sha256, sourceAuditEventId: auditId } });
      await database.conventionalDraft.update({ where: { id: draft.id }, data: { status: "FINAL", orderSnapshotId: snapshotId, orderHash: sha256 } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { state: LifecycleState.ORDER_FINAL, rowVersion: { increment: 1 } } });
    });
    return this.draftSummary(metadata.actor, metadata.seasonId);
  }

  async makePick(metadata: CommandMetadata, input: DraftPickInput): Promise<DraftOrderSummary> {
    await this.setupCommand(metadata, async database => {
      const draft = await database.conventionalDraft.findUniqueOrThrow({ where: { seasonId: metadata.seasonId } });
      if (draft.status !== "FINAL" && draft.status !== "IN_PROGRESS") throw new Error("Conventional draft is not open");
      const order = await database.draftOrderEntry.findMany({ where: { conventionalDraftId: draft.id }, orderBy: { orderPosition: "asc" } }); const pickCount = await database.draftPick.count({ where: { conventionalDraftId: draft.id, active: true } });
      const current = order[pickCount % order.length]; if (!current || current.seasonTeamId !== input.seasonTeamId) throw new Error("Only the team currently on the clock may pick");
      const player = await database.player.findFirst({ where: { id: input.playerId, seasonId: metadata.seasonId, available: true } }); if (!player) throw new Error("Player is unavailable");
      const assignments = await database.rosterAssignment.findMany({ where: { seasonId: metadata.seasonId, seasonTeamId: input.seasonTeamId, supersededAt: null } }); const players = await database.player.findMany({ where: { id: { in: assignments.map(item => item.playerId) } } });
      const result = canAddPlayerThroughPhase1(players.map(item => item.position), player.position, input.rosterRules); if (!result.legal) throw new Error(`Illegal partial roster: ${result.reason}`);
      const overallPick = pickCount + 1; const pickId = randomUUID(); await database.draftPick.create({ data: { id: pickId, conventionalDraftId: draft.id, overallPick, roundNumber: Math.floor(pickCount / order.length) + 1, orderPosition: (pickCount % order.length) + 1, seasonTeamId: input.seasonTeamId, playerId: input.playerId } });
      await database.rosterAssignment.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, seasonTeamId: input.seasonTeamId, playerId: input.playerId, acquisitionSource: "CONVENTIONAL", sourceEntityId: pickId } }); await database.player.update({ where: { id: input.playerId }, data: { available: false } });
      const total = await database.seasonTeam.count({ where: { seasonId: metadata.seasonId, active: true } }) * 14; const complete = overallPick + await database.rosterAssignment.count({ where: { seasonId: metadata.seasonId, acquisitionSource: { not: "CONVENTIONAL" }, supersededAt: null } }) === total;
      if (complete) { const allAssignments = await database.rosterAssignment.findMany({ where: { seasonId: metadata.seasonId, supersededAt: null } }); for (const team of order) { const ids = allAssignments.filter(item => item.seasonTeamId === team.seasonTeamId).map(item => item.playerId); if (ids.length !== 14) throw new Error("Draft cannot complete until every team has exactly 14 players"); const rosterPlayers = await database.player.findMany({ where: { id: { in: ids } } }); if (!validateRosterThroughPhase1(rosterPlayers.map(item => item.position), input.rosterRules).legal) throw new Error("Draft cannot complete with an illegal roster"); } }
      await database.conventionalDraft.update({ where: { id: draft.id }, data: { status: complete ? "COMPLETED" : "IN_PROGRESS", ...(complete ? { completedAt: new Date() } : {}) } }); await database.season.update({ where: { id: metadata.seasonId }, data: { state: complete ? LifecycleState.COMPLETED : LifecycleState.CONVENTIONAL_DRAFT, rowVersion: { increment: 1 } } });
    });
    return this.draftSummary(metadata.actor, metadata.seasonId);
  }

  async draftSummary(_actor: ActorDescriptor, seasonId: string): Promise<DraftOrderSummary> {
    const draft = await this.prisma.conventionalDraft.findUniqueOrThrow({ where: { seasonId } }); const [entries, teams, balances, decisions, picks] = await Promise.all([this.prisma.draftOrderEntry.findMany({ where: { conventionalDraftId: draft.id }, orderBy: { orderPosition: "asc" } }), this.prisma.seasonTeam.findMany({ where: { seasonId } }), this.prisma.teamAuctionBalance.findMany({ where: { seasonId, roundNumber: 2 } }), this.prisma.draftOrderTieDecision.findMany({ where: { conventionalDraftId: draft.id } }), this.prisma.draftPick.count({ where: { conventionalDraftId: draft.id, active: true } })]); const names = new Map(teams.map(team => [team.id, team.displayName])); const decided = new Set(decisions.map(item => item.balance)); const ties = [...groupBalances(balances)].filter(([balance, group]) => group.length > 1 && !decided.has(balance)).map(([balance, group]) => ({ balance, seasonTeamIds: group.map(item => item.seasonTeamId) })); const current = entries.length ? entries[picks % entries.length]?.seasonTeamId : undefined; return { status: draft.status as DraftOrderSummary["status"], ties, order: entries.map(item => ({ orderPosition: item.orderPosition, seasonTeamId: item.seasonTeamId, displayName: names.get(item.seasonTeamId)!, remainingBalance: item.remainingBalance })), nextOverallPick: picks + 1, ...(current && draft.status !== "COMPLETED" ? { currentSeasonTeamId: current } : {}) };
  }


  async summary(_actor: ActorDescriptor, seasonId: string, roundNumber: AuctionRoundNumber, reveal = false): Promise<AuctionRoundSummary> { const round = await this.prisma.auctionRound.findFirstOrThrow({ where: { seasonId, roundNumber, supersededAt: null } }); const [submissions, teams, attempts, balances] = await Promise.all([this.prisma.auctionSubmission.findMany({ where: { roundId: round.id } }), this.prisma.seasonTeam.findMany({ where: { seasonId }, orderBy: { seedOrder: "asc" } }), this.prisma.auctionAttempt.findMany({ where: { roundId: round.id, supersededAt: null }, orderBy: { attemptNumber: "asc" } }), this.prisma.teamAuctionBalance.findMany({ where: { seasonId, roundNumber } })]); const submissionMap = new Map(submissions.map(s => [s.seasonTeamId, s])); const canReveal = reveal && round.status !== "BIDDING"; return { roundId: round.id, roundNumber, status: round.status, revealed: canReveal, teams: teams.map(team => { const item = submissionMap.get(team.id)!; return { seasonTeamId: team.id, teamId: team.teamId, displayName: team.displayName, status: item.status, bidCount: item.bidCount, ...(canReveal ? { bids: JSON.parse(item.bidsJson) } : {}) }; }), attempts: attempts.map(a => ({ attemptNumber: a.attemptNumber, status: a.status, inputHash: a.inputHash, outputHash: a.outputHash, unresolvedTies: (JSON.parse(a.outputJson) as AuctionEngineResult).unresolvedTies })), balances: balances.map(b => ({ seasonTeamId: b.seasonTeamId, startingBudget: b.startingBudget, spent: b.spent, remainingBudget: b.remainingBudget })) }; }
  async close(): Promise<void> { await this.prisma.$disconnect(); }
}

export async function openSeasonStore(path: string): Promise<PrismaSeasonStore> {
  if (existsSync(path) && databaseNeedsMigration(path)) await migrateDatabaseCopySafely(path);
  else migrateDatabaseInPlace(path);
  const adapter = new PrismaBetterSqlite3({ url: path }, { timestampFormat: "iso8601" });
  const prisma = new PrismaClient({ adapter });
  await prisma.$connect();
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = DELETE");
  await prisma.$executeRawUnsafe("PRAGMA synchronous = FULL");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
  return new PrismaSeasonStore(prisma);
}
