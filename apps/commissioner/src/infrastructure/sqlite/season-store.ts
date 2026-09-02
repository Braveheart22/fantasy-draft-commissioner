import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { assertLifecycleTransition } from "../../application/commands/lifecycle.js";
import type { CatalogPlayer, CatalogQuery, CatalogRepository, PlayerSearchPage, PlayerSearchQuery } from "../../application/catalog/catalog-repository.js";
import type { CatalogDisposition, CatalogPreparationRepository, CatalogPreparationView, CatalogReviewKind } from "../../application/catalog/catalog-preparation-repository.js";
import type { CatalogNormalizationResult, CanonicalCatalogRow } from "../../application/catalog-sources/canonical-catalog-normalizer.js";
import type { CanonicalCatalogFormat } from "../../application/catalog-sources/catalog-source.js";
import type { NormalizedPriceList, PriceListFormat } from "../../application/pricing/price-list-normalizer.js";
import type { PricePreparationView, PricingRepository, PricingSummary } from "../../application/pricing/pricing-repository.js";
import type { BootstrapRepository } from "../../application/bootstrap/bootstrap-repository.js";
import { deriveAvailability } from "../../application/catalog/catalog-service.js";
import type { AuctionBidDraft, AuctionRepository, AuctionRoundNumber, AuctionRoundSummary, AuctionSubmissionStatus, TieDecisionInput } from "../../application/auction/auction-repository.js";
import type { AuctionEngineResult, CommissionerAuctionInput } from "../../application/ports/auction-engine.js";
import type { ActorDescriptor, CommandMetadata, SeasonRecord, SeasonRepository, SeasonTransaction } from "../../application/ports/season-repository.js";
import { LifecycleState } from "../../application/ports/season-repository.js";
import { PLAYER_POSITIONS, type ImportPreview, type ImportRow, type KeeperStagePlayer, type KeeperStageSummary, type PlayerInput, type SetupRepository, type SetupSummary, type TeamInput } from "../../application/setup/setup-repository.js";
import type { DraftOrderDecision, DraftOrderRepository, DraftOrderSummary } from "../../application/draft-order/draft-order-repository.js";
import type { ConventionalDraftRepository, DraftPickInput } from "../../application/conventional-draft/conventional-draft-repository.js";
import type { ResultsRepository, ResultsSummary } from "../../application/results/results-repository.js";
import type { OperationsQuery, OperationsRepository, OperationsSummary } from "../../application/operations/operations-repository.js";
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

function normalizeSearchText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
type SavedAuctionBid = { bidId: string; priority: 1 | 2 | 3; playerId: string; amount: number };
function revealedBids(bidsJson: string, playerNames: Map<string, string>) {
  return (JSON.parse(bidsJson) as SavedAuctionBid[]).map(bid => ({ ...bid, playerName: playerNames.get(bid.playerId) ?? "Unknown player" }));
}
function groupBalances<T extends { remainingBudget: number }>(items: T[]): Map<number, T[]> { const groups = new Map<number, T[]>(); for (const item of items) groups.set(item.remainingBudget, [...(groups.get(item.remainingBudget) ?? []), item]); return groups; }
function auditStage(event: { commandType: string; beforeJson?: string | null; afterJson?: string | null }): string {
  const commandType = event.commandType;
  if (/CORRECTION|BACKUP|RECOVERY|EXPORT/.test(commandType)) return "OPERATIONS";
  if (/DRAFT_PICK|DRAFT_ORDER|ORDER_TIE/.test(commandType)) return "DRAFT";
  if (/AUCTION|BID|ROUND_[12]/.test(commandType)) {
    const payloads = [event.beforeJson, event.afterJson].map(value => { try { return value ? (JSON.parse(value) as { state?: string; roundNumber?: number }) : undefined; } catch { return undefined; } }).filter(Boolean);
    const state = payloads.map(value => value?.state).find(Boolean);
    if (payloads.some(value => value?.roundNumber === 2)) return "AUCTION_2";
    if (state && (/^R2_/.test(state) || ["R1_PUBLISHED", "R2_PUBLISHED", "ORDER_TIE_PAUSED", "ORDER_FINAL", "CONVENTIONAL_DRAFT", "COMPLETED"].includes(state))) return "AUCTION_2";
    return commandType.includes("ROUND_2") ? "AUCTION_2" : "AUCTION_1";
  }
  if (/KEEPER/.test(commandType)) return "KEEPERS";
  return "SETUP";
}
async function requireSelectablePlayer(database: any, seasonId: string, playerId: string) {
  const player = await database.player.findFirst({ where: { id: playerId, seasonId } });
  if (!player) throw new Error(`Player is unavailable: ${playerId}`);
  const owned = Boolean(await database.rosterAssignment.findFirst({ where: { seasonId, playerId, supersededAt: null }, select: { id: true } }));
  const availability = deriveAvailability({ owned, leagueSelectable: player.leagueSelectable, providerActive: player.providerActive });
  if (!availability.available) throw new Error(`Player is unavailable: ${playerId} (${availability.reason})`);
  if (!player.available) throw new Error(`Player availability compatibility projection is inconsistent: ${playerId}`);
  return player;
}

export class PrismaSeasonStore implements SeasonRepository, SetupRepository, AuctionRepository, DraftOrderRepository, ConventionalDraftRepository, CatalogRepository, CatalogPreparationRepository, PricingRepository, BootstrapRepository, ResultsRepository, OperationsRepository {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly prisma: PrismaClient) {}
  async seasonVersion(seasonId: string): Promise<number> { return (await this.prisma.season.findUniqueOrThrow({ where: { id: seasonId }, select: { rowVersion: true } })).rowVersion; }

  async results(_actor: ActorDescriptor, seasonId: string): Promise<ResultsSummary> {
    return this.prisma.$transaction(async database => {
      const season = await database.season.findUnique({ where: { id: seasonId } });
      if (!season) throw Object.assign(new Error("Season not found"), { statusCode: 404 });
      const draft = await database.conventionalDraft.findUnique({ where: { seasonId } });
      const [teams, assignments, picks, backups, exports] = await Promise.all([
        database.seasonTeam.findMany({ where: { seasonId, active: true }, orderBy: { seedOrder: "asc" } }),
        database.rosterAssignment.findMany({ where: { seasonId, supersededAt: null }, orderBy: [{ seasonTeamId: "asc" }, { playerId: "asc" }] }),
        draft ? database.draftPick.findMany({ where: { conventionalDraftId: draft.id, active: true }, orderBy: { overallPick: "asc" } }) : Promise.resolve([]),
        database.backupRecord.findMany({ where: { seasonId }, orderBy: { verifiedAt: "desc" }, take: 1 }),
        database.exportRecord.findMany({ where: { seasonId, supersededAt: null }, orderBy: { createdAt: "desc" } }),
      ]);
      const referencedPlayerIds = [...new Set([...assignments.map(item => item.playerId), ...picks.map(item => item.playerId)])];
      const players = await database.player.findMany({ where: { seasonId, id: { in: referencedPlayerIds } }, select: { id: true, name: true, position: true, sourceType: true } });
      const playerById = new Map(players.map(player => [player.id, player])); const pickById = new Map(picks.map(pick => [pick.id, pick])); const teamById = new Map(teams.map(team => [team.id, team]));
      return {
        season: { id: season.id, name: season.name, year: season.year, state: season.state, rowVersion: season.rowVersion },
        teams: teams.map(team => ({ seasonTeamId: team.id, displayName: team.displayName, seedOrder: team.seedOrder, players: assignments.filter(item => item.seasonTeamId === team.id).map(item => { const player = playerById.get(item.playerId)!; const pick = pickById.get(item.sourceEntityId); return { playerId: player.id, playerName: player.name, position: player.position, sourceType: player.sourceType, acquisitionSource: item.acquisitionSource, ...(item.auctionRound == null ? {} : { auctionRound: item.auctionRound }), ...(item.cost == null ? {} : { cost: item.cost }), ...(pick ? { overallPick: pick.overallPick } : {}) }; }) })),
        history: picks.map(pick => { const team = teamById.get(pick.seasonTeamId)!; const player = playerById.get(pick.playerId)!; return { overallPick: pick.overallPick, roundNumber: pick.roundNumber, displayName: team.displayName, playerName: player.name, position: player.position }; }),
        backup: backups[0] ? { available: true, lastVerifiedAt: backups[0].verifiedAt.toISOString(), trigger: backups[0].trigger } : { available: false },
        exports: exports.map(item => ({ id: item.id, createdAt: item.createdAt.toISOString(), jsonSha256: item.jsonSha256, csvSha256: item.csvSha256 })),
      };
    });
  }

  async operations(_actor: ActorDescriptor, seasonId: string, query: OperationsQuery): Promise<OperationsSummary> {
    if (!await this.prisma.season.findUnique({ where: { id: seasonId }, select: { id: true } })) throw Object.assign(new Error("Season not found"), { statusCode: 404 });
    const page = Math.max(1, query.page ?? 1); const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const auditWhere: any = { seasonId };
    if (query.commandType) auditWhere.commandType = query.commandType;
    if (query.entityType) auditWhere.entityType = query.entityType;
    if (query.correlationId) auditWhere.correlationId = query.correlationId;
    if (query.correctionLineage) auditWhere.OR = [{ commandType: { contains: "CORRECTION" } }, { entityType: "CorrectionAction" }];
    const unfilteredTotal = query.stage ? undefined : await this.prisma.auditEvent.count({ where: auditWhere });
    const initialPages = Math.max(1, Math.ceil((unfilteredTotal ?? 0) / pageSize)); const initialPage = Math.min(page, initialPages);
    const [auditRows, teams, players, keepers, rounds, awards, orderDecisions, draft, priceBatches, manualPrices, catalogBatches, activeCatalogSnapshots, floors, corrections] = await Promise.all([
      this.prisma.auditEvent.findMany({ where: auditWhere, orderBy: { sequence: "desc" }, ...(query.stage ? {} : { skip: (initialPage - 1) * pageSize, take: pageSize }) }),
      this.prisma.seasonTeam.findMany({ where: { seasonId } }), this.prisma.player.findMany({ where: { seasonId }, select: { id: true, name: true, position: true, custom: true, supersededAt: true } }),
      this.prisma.keeperSelection.findMany({ where: { seasonId } }), this.prisma.auctionRound.findMany({ where: { seasonId } }),
      this.prisma.auctionAward.findMany({ where: { round: { seasonId } } }),
      this.prisma.draftOrderTieDecision.findMany({ where: { conventionalDraft: { seasonId } } }),
      this.prisma.conventionalDraft.findUnique({ where: { seasonId } }),
      this.prisma.pricePreparationBatch.findMany({ where: { seasonId, state: "APPROVED", supersededAt: null } }),
      this.prisma.playerPriceAssignment.findMany({ where: { seasonId, sourceType: "MANUAL", active: true } }),
      this.prisma.catalogPreparationBatch.findMany({ where: { seasonId, state: "APPROVED" } }),
      this.prisma.catalogSnapshot.findMany({ where: { seasonId, state: "APPROVED", supersededAt: null }, select: { id: true } }),
      this.prisma.positionPriceFloor.findMany({ where: { seasonId, supersededAt: null } }),
      this.prisma.correctionAction.findMany({ where: { seasonId }, orderBy: { createdAt: "desc" } }),
    ]);
    const picks = draft ? await this.prisma.draftPick.findMany({ where: { conventionalDraftId: draft.id }, orderBy: { overallPick: "asc" } }) : [];
    const teamName = new Map(teams.map(item => [item.id, item.displayName])); const playerName = new Map(players.map(item => [item.id, item.name])); const roundNumber = new Map(rounds.map(item => [item.id, item.roundNumber]));
    let timeline = auditRows.map(item => ({ sequence: item.sequence, createdAt: item.createdAt.toISOString(), actorLabel: item.actorLabel, commandType: item.commandType, stage: auditStage(item), ...(item.entityType ? { entityType: item.entityType } : {}), ...(item.entityId ? { entityId: item.entityId } : {}), correlationId: item.correlationId, ...(item.reason ? { reason: item.reason } : {}) }));
    if (query.stage) timeline = timeline.filter(item => item.stage === query.stage);
    const total = unfilteredTotal ?? timeline.length; const totalPages = Math.max(1, Math.ceil(total / pageSize)); const effectivePage = Math.min(page, totalPages); const items = query.stage ? timeline.slice((effectivePage - 1) * pageSize, effectivePage * pageSize) : timeline;
    const state = (supersededAt: Date | null | undefined, active = true): "ACTIVE" | "SUPERSEDED" => supersededAt || !active ? "SUPERSEDED" : "ACTIVE";
    let records = [
      ...keepers.map(item => ({ kind: "Keeper", id: item.id, label: `${teamName.get(item.seasonTeamId)} · ${playerName.get(item.playerId)}`, detail: `$${item.cost} keeper`, state: state(item.supersededAt), correctionType: "KEEPER", targetId: item.id })),
      ...rounds.map(item => ({ kind: "Auction round", id: item.id, label: `Round ${item.roundNumber} · ${item.status}`, detail: item.publishedAt ? "Published" : "Not published", state: state(item.supersededAt), correctionType: "AUCTION_REOPEN", targetId: item.id })),
      ...awards.map(item => ({ kind: "Auction award", id: item.id, label: `Round ${roundNumber.get(item.roundId)} · ${playerName.get(item.playerId)} → ${teamName.get(item.seasonTeamId)}`, detail: `$${item.amount}`, state: state(item.supersededAt) })),
      ...orderDecisions.map(item => ({ kind: "Order decision", id: item.id, label: `$${item.balance} tie · ${item.method}`, detail: "External precedence", state: state(item.supersededAt), correctionType: "DRAFT_ORDER", targetId: draft?.id })),
      ...picks.map(item => ({ kind: "Draft pick", id: item.id, label: `Pick ${item.overallPick} · ${playerName.get(item.playerId)} → ${teamName.get(item.seasonTeamId)}`, detail: `Round ${item.roundNumber}`, state: state(item.supersededAt, item.active), correctionType: "PICK", targetId: item.id })),
      ...corrections.map(item => ({ kind: "Correction", id: item.id, label: `${item.correctionType} · ${item.confirmedAt ? "Confirmed" : "Preview"}`, detail: item.reason ?? "Awaiting confirmation", state: state(item.supersededAt), correctionType: item.correctionType, ...(item.targetId ? { targetId: item.targetId } : {}) })),
    ];
    if (query.recordState) records = records.filter(item => item.state === query.recordState);
    const correctionTargets = [
      ...catalogBatches.filter(item => activeCatalogSnapshots.some(snapshot => snapshot.id === item.id)).map(item => ({ correctionType: "CATALOG_BATCH", targetId: item.id, label: `Catalog · ${item.sourceNamespace}`, detail: `${item.rowCount} approved rows` })),
      ...players.filter(item => item.custom && !item.supersededAt && [...keepers, ...awards, ...picks].some(record => record.playerId === item.id)).map(item => ({ correctionType: "CUSTOM_PLAYER", targetId: item.id, label: `Custom player · ${item.name}`, detail: item.position })),
      ...(floors.length ? [{ correctionType: "POSITION_FLOORS", label: "Positional price floors", detail: `${floors.length} active floors` }] : []),
      ...priceBatches.map(item => ({ correctionType: "PRICE_BATCH", targetId: item.id, label: `Price list · ${item.sourceLabel}`, detail: `${item.rowCount} approved rows` })),
      ...manualPrices.map(item => ({ correctionType: "MANUAL_PRICE", targetId: item.id, label: `Manual price · ${playerName.get(item.playerId)}`, detail: `$${item.minimumBid} · ${item.sourceLabel}` })),
      ...picks.filter(item => item.active).map(item => ({ correctionType: "PICK", targetId: item.id, label: `Pick ${item.overallPick} · ${playerName.get(item.playerId)} → ${teamName.get(item.seasonTeamId)}`, detail: `Round ${item.roundNumber}` })),
      ...rounds.filter(item => !item.supersededAt).map(item => ({ correctionType: "AUCTION_REOPEN", targetId: item.id, label: `Auction round ${item.roundNumber}`, detail: item.status })),
      ...(draft ? [{ correctionType: "DRAFT_ORDER", targetId: draft.id, label: "Permanent draft order", detail: draft.status }] : []),
    ];
    return { timeline: { items, page: effectivePage, pageSize, total, totalPages }, records, correctionTargets };
  }

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
  async readBootstrap(_actor: ActorDescriptor, seasonId: string) {
    const run = this.queue.then(() => this.prisma.$transaction(async database => {
      const seasonRow = await database.season.findUnique({ where: { id: seasonId } });
      if (!seasonRow) throw new Error(`Season not found: ${seasonId}`);
      const season = mapSeason(seasonRow);
      const [teams, players, floors, rounds, draft] = await Promise.all([
        database.seasonTeam.findMany({ where: { seasonId }, include: { keeper: true }, orderBy: { seedOrder: "asc" } }),
        database.player.findMany({ where: { seasonId }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
        database.positionPriceFloor.findMany({ where: { seasonId, supersededAt: null } }),
        database.auctionRound.findMany({ where: { seasonId, supersededAt: null }, orderBy: { roundNumber: "asc" } }),
        database.conventionalDraft.findUnique({ where: { seasonId } }),
      ]);
      const floorMap = Object.fromEntries(floors.map(floor => [floor.position, floor.minimumBid]));
      const setup: SetupSummary = {
        season,
        teams: teams.map(team => ({ id: team.teamId, seasonTeamId: team.id, displayName: team.displayName, seedOrder: team.seedOrder, ...(team.keeper ? { keeperPlayerId: team.keeper.playerId } : {}), startingBudget: team.keeper ? 300 : 350 })),
        players: players.map(player => { const minimumBid = player.explicitMinimumBid ?? floorMap[player.position]; return { id: player.id, name: player.name, position: player.position as PlayerInput["position"], sourceType: player.sourceType as PlayerInput["sourceType"], ...(player.sourceNamespace ? { sourceNamespace: player.sourceNamespace } : {}), ...(player.externalId ? { externalId: player.externalId } : {}), ...(player.explicitMinimumBid == null ? {} : { explicitMinimumBid: player.explicitMinimumBid }), ...(minimumBid === undefined ? {} : { minimumBid }), available: player.available, keeperEligible: player.keeperEligible }; }),
        floors: floorMap,
      };
      const auctionSummary = async (round: typeof rounds[number]): Promise<AuctionRoundSummary> => {
        const [submissions, attempts, balances] = await Promise.all([
          database.auctionSubmission.findMany({ where: { roundId: round.id } }),
          database.auctionAttempt.findMany({ where: { roundId: round.id, supersededAt: null }, orderBy: { attemptNumber: "asc" } }),
          database.teamAuctionBalance.findMany({ where: { seasonId, roundNumber: round.roundNumber } }),
        ]);
        const submissionMap = new Map(submissions.map(item => [item.seasonTeamId, item]));
        const revealed = round.status !== "BIDDING";
        const playerNames = new Map(players.map(player => [player.id, player.name]));
        return { rowVersion: season.rowVersion, roundId: round.id, roundNumber: round.roundNumber as AuctionRoundNumber, status: round.status, revealed, teams: teams.map(team => { const item = submissionMap.get(team.id); return { seasonTeamId: team.id, teamId: team.teamId, displayName: team.displayName, status: (item?.status ?? "DRAFT") as AuctionSubmissionStatus, bidCount: item?.bidCount ?? 0, ...(revealed && item ? { bids: revealedBids(item.bidsJson, playerNames) } : {}) }; }), attempts: attempts.map(item => ({ attemptNumber: item.attemptNumber, status: item.status, inputHash: item.inputHash, outputHash: item.outputHash, unresolvedTies: (JSON.parse(item.outputJson) as AuctionEngineResult).unresolvedTies })), balances: balances.map(item => ({ seasonTeamId: item.seasonTeamId, startingBudget: item.startingBudget, spent: item.spent, remainingBudget: item.remainingBudget })) };
      };
      const summaries = await Promise.all(rounds.map(auctionSummary));
      let draftSummary: DraftOrderSummary | null = null;
      if (draft) {
        const [entries, balances, decisions, pickRows, assignments] = await Promise.all([
          database.draftOrderEntry.findMany({ where: { conventionalDraftId: draft.id, supersededAt: null }, orderBy: { orderPosition: "asc" } }),
          database.teamAuctionBalance.findMany({ where: { seasonId, roundNumber: 2 } }),
          database.draftOrderTieDecision.findMany({ where: { conventionalDraftId: draft.id, supersededAt: null } }),
          database.draftPick.findMany({ where: { conventionalDraftId: draft.id, active: true }, orderBy: { overallPick: "desc" } }),
          database.rosterAssignment.findMany({ where: { seasonId, supersededAt: null } }),
        ]);
        const names = new Map(teams.map(team => [team.id, team.displayName]));
        const decided = new Set(decisions.map(item => item.balance));
        const ties = [...groupBalances(balances)].filter(([balance, group]) => group.length > 1 && !decided.has(balance)).map(([balance, group]) => ({ balance, seasonTeamIds: group.map(item => item.seasonTeamId) }));
        const pickCount = pickRows.length;
        const current = entries.length ? entries[pickCount % entries.length]?.seasonTeamId : undefined;
        const playerById = new Map(players.map(player => [player.id, player]));
        const pickByPlayerId = new Map(pickRows.map(pick => [pick.playerId, pick]));
        const rosterRules = { limits: { QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 }, flexEligible: ["RB", "WR", "TE"], flexCapacity: 1 };
        const teamModels = teams.map(team => { const owned = assignments.filter(item => item.seasonTeamId === team.id); const positions = owned.map(item => playerById.get(item.playerId)?.position).filter((position): position is string => Boolean(position)); return { seasonTeamId: team.id, displayName: team.displayName, roster: owned.map(item => { const player = playerById.get(item.playerId)!; const pick = pickByPlayerId.get(item.playerId); return { playerId: player.id, playerName: player.name, position: player.position, acquisitionSource: item.acquisitionSource, ...(item.cost === null ? {} : { cost: item.cost }), ...(item.auctionRound === null ? {} : { auctionRound: item.auctionRound }), ...(pick ? { overallPick: pick.overallPick } : {}) }; }), positionCounts: Object.fromEntries(PLAYER_POSITIONS.map(position => [position, positions.filter(value => value === position).length])), openSlots: Math.max(0, 14 - owned.length), legalNextPositions: PLAYER_POSITIONS.filter(position => canAddPlayerThroughPhase1(positions, position, rosterRules).legal) }; });
        draftSummary = { rowVersion: season.rowVersion, status: draft.status as DraftOrderSummary["status"], ties, order: entries.map(item => ({ orderPosition: item.orderPosition, seasonTeamId: item.seasonTeamId, displayName: names.get(item.seasonTeamId)!, remainingBalance: item.remainingBalance })), nextOverallPick: pickCount + 1, currentRound: entries.length ? Math.floor(pickCount / entries.length) + 1 : 1, filledRosterSlots: assignments.length, totalRosterSlots: teams.length * 14, teams: teamModels, history: pickRows.map(pick => { const player = playerById.get(pick.playerId)!; return { overallPick: pick.overallPick, roundNumber: pick.roundNumber, orderPosition: pick.orderPosition, seasonTeamId: pick.seasonTeamId, displayName: names.get(pick.seasonTeamId)!, playerId: player.id, playerName: player.name, position: player.position }; }), ...(current && draft.status !== "COMPLETED" ? { currentSeasonTeamId: current } : {}) };
      }
      const teamsReady = teams.length === season.teamCount;
      const catalogReady = players.length > 0;
      const pricingReady = PLAYER_POSITIONS.every(position => floorMap[position] !== undefined);
      return { season, setup, readiness: { setupReady: teamsReady && catalogReady && pricingReady, teamsReady, catalogReady, pricingReady }, phases: { auctionOne: summaries.find(item => item.roundNumber === 1) ?? null, auctionTwo: summaries.find(item => item.roundNumber === 2) ?? null, draft: draftSummary } };
    }));
    return run;
  }
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
      await database.player.create({ data: { ...player, seasonId: metadata.seasonId, custom: true, explicitMinimumBid: player.explicitMinimumBid ?? null, normalizedSearchText: normalizeSearchText(player.name), providerStatus: "ACTIVE", providerActive: true, leagueSelectable: true } });
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
      if (prior) await database.catalogSnapshot.updateMany({ where: { id: prior.id, supersededAt: null }, data: { state: "SUPERSEDED", supersededAt: new Date() } });
      if (prior) await database.player.updateMany({ where: { seasonId: metadata.seasonId, activeImportBatchId: prior.id, custom: false }, data: { providerStatus: "INACTIVE", providerActive: false, available: false } });
      await database.playerImportBatch.create({ data: { id: batchId, seasonId: metadata.seasonId, sourceNamespace: namespace, format, sha256: preview.hash, rowCount: preview.rows.length, supersedesId: prior?.id ?? null } });
      await database.catalogSnapshot.create({ data: { id: batchId, seasonId: metadata.seasonId, sourceNamespace: namespace, state: "APPROVED", sourceHash: preview.hash, normalizedHash: hashJson(preview.rows), approvedAt: new Date(), supersedesId: prior?.id ?? null } });
      for (const row of preview.rows) {
        const current = await database.player.findFirst({ where: { seasonId: metadata.seasonId, sourceType: "NFL", sourceNamespace: namespace, externalId: row.externalId } });
        const owned = current ? Boolean(await database.rosterAssignment.findFirst({ where: { seasonId: metadata.seasonId, playerId: current.id, supersededAt: null }, select: { id: true } })) : false;
        const data = { name: row.name, position: row.position, explicitMinimumBid: row.explicitMinimumBid ?? null, activeImportBatchId: batchId, catalogSnapshotId: batchId, available: !owned, normalizedSearchText: normalizeSearchText(row.name), providerStatus: "ACTIVE", providerActive: true, leagueSelectable: true };
        if (current) await database.player.update({ where: { id: current.id }, data });
        else {
          const id = randomUUID();
          await database.player.create({ data: { id, seasonId: metadata.seasonId, sourceType: "NFL", sourceNamespace: namespace, externalId: row.externalId, custom: false, ...data } });
          await database.playerSourceAlias.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, playerId: id, sourceNamespace: namespace, sourceId: row.externalId } });
        }
      }
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
      return { noOp: false, batchId };
    });
  }

  async catalogPreparation(_actor: ActorDescriptor, seasonId: string, batchId: string): Promise<CatalogPreparationView> {
    const batch = await this.prisma.catalogPreparationBatch.findFirst({ where: { id: batchId, seasonId }, include: { rows: { orderBy: { rowNumber: "asc" } } } });
    if (!batch) throw new Error(`Catalog preparation not found: ${batchId}`);
    const rows = batch.rows.map(row => ({ rowNumber: row.rowNumber, operation: row.operation as "UPSERT" | "OMIT", externalId: row.externalId, name: row.name, position: row.position, ...(row.reviewKind ? { reviewKind: row.reviewKind as CatalogReviewKind } : {}), ...(row.reviewMessage ? { reviewMessage: row.reviewMessage } : {}), ...(row.disposition ? { disposition: row.disposition as CatalogDisposition } : {}), ...(row.resolutionPlayerId ? { resolutionPlayerId: row.resolutionPlayerId } : {}) }));
    const state = batch.state === "STAGED" && batch.expiresAt && batch.expiresAt <= new Date() ? "EXPIRED" : batch.state;
    return { id: batch.id, sourceNamespace: batch.sourceNamespace, format: batch.format as CanonicalCatalogFormat, sourceHash: batch.sourceHash, normalizedHash: batch.normalizedHash, expectedSeasonVersion: batch.expectedSeasonVersion, state: state as CatalogPreparationView["state"], rowCount: batch.rowCount, unresolvedCount: rows.filter(row => row.reviewKind && !row.disposition).length, rows };
  }

  async stageCatalog(metadata: CommandMetadata, sourceNamespace: string, format: CanonicalCatalogFormat, normalized: CatalogNormalizationResult): Promise<CatalogPreparationView> {
    await this.assertSetup(metadata.seasonId);
    const existing = await this.prisma.catalogPreparationBatch.findUnique({ where: { seasonId_sourceNamespace_sourceHash: { seasonId: metadata.seasonId, sourceNamespace, sourceHash: normalized.sourceHash } } });
    if (existing) return this.catalogPreparation(metadata.actor, metadata.seasonId, existing.id);
    const batchId = await this.setupCommand(metadata, async database => {
      const season = await database.season.findUniqueOrThrow({ where: { id: metadata.seasonId } });
      const id = randomUUID();
      await database.catalogPreparationBatch.create({ data: { id, seasonId: metadata.seasonId, sourceNamespace, format, sourceHash: normalized.sourceHash, normalizedHash: normalized.normalizedHash, expectedSeasonVersion: season.rowVersion + 1, state: "STAGED", rowCount: normalized.rows.length, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
      const [players, aliases, keepers, assignments, awards, picks] = await Promise.all([
        database.player.findMany({ where: { seasonId: metadata.seasonId }, include: { aliases: true } }),
        database.playerSourceAlias.findMany({ where: { seasonId: metadata.seasonId } }),
        database.keeperSelection.findMany({ where: { seasonId: metadata.seasonId }, select: { playerId: true } }),
        database.rosterAssignment.findMany({ where: { seasonId: metadata.seasonId }, select: { playerId: true } }),
        database.auctionAward.findMany({ where: { round: { seasonId: metadata.seasonId } }, select: { playerId: true } }),
        database.draftPick.findMany({ where: { conventionalDraft: { seasonId: metadata.seasonId } }, select: { playerId: true } }),
      ]);
      const names = new Map<string, typeof players>();
      for (const player of players) names.set(player.normalizedSearchText, [...(names.get(player.normalizedSearchText) ?? []), player]);
      const identities = new Map(players.filter(player => player.sourceNamespace === sourceNamespace && player.externalId).map(player => [player.externalId!, player]));
      const aliasMap = new Map(aliases.map(alias => [`${alias.sourceNamespace}\u0000${alias.sourceId}`, alias]));
      const stagedRows = normalized.rows.map((row, index) => {
        const normalizedName = normalizeSearchText(row.name);
        const sameName = names.get(normalizedName) ?? [];
        const custom = sameName.find(player => player.custom);
        const sameIdentity = identities.get(row.externalId);
        const changedId = sameName.find(player => player.sourceNamespace === sourceNamespace && player.externalId !== row.externalId);
        const crossSource = sameName.find(player => !player.custom && player.sourceNamespace !== sourceNamespace);
        const aliasCollision = row.aliases.map(alias => aliasMap.get(`${alias.sourceNamespace}\u0000${alias.sourceId}`)).find(Boolean);
        let reviewKind: CatalogReviewKind | undefined, reviewMessage: string | undefined;
        if (aliasCollision && (!sameIdentity || aliasCollision.playerId !== sameIdentity.id)) { reviewKind = "ALIAS_COLLISION"; reviewMessage = `${row.name} aliases resolve to another player`; }
        else if (custom) { reviewKind = "CUSTOM_COLLISION"; reviewMessage = `${row.name} matches protected custom player ${custom.id}`; }
        else if (changedId) { reviewKind = "EXTERNAL_ID_CHANGE"; reviewMessage = `${row.name} changed external ID from ${changedId.externalId} to ${row.externalId}`; }
        else if (crossSource && !aliasCollision) { reviewKind = "CROSS_SOURCE_IDENTITY"; reviewMessage = `${row.name} matches ${crossSource.sourceNamespace ?? crossSource.sourceType} without a shared alias`; }
        else if (sameIdentity && (sameIdentity.name !== row.name || sameIdentity.position !== row.position || sameIdentity.nflTeam !== (row.nflTeam ?? null) || sameIdentity.providerStatus !== row.providerStatus || sameIdentity.providerActive !== row.providerActive)) { reviewKind = "IDENTITY_CHANGE"; reviewMessage = `${row.externalId} changes approved player facts`; }
        return { id: randomUUID(), batchId: id, rowNumber: index + 1, operation: "UPSERT", externalId: row.externalId, name: row.name, position: row.position, nflTeam: row.nflTeam ?? null, providerStatus: row.providerStatus, providerActive: row.providerActive, leagueSelectable: row.leagueSelectable, sourceUpdatedAt: row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt) : null, aliasesJson: JSON.stringify(row.aliases), reviewKind: reviewKind ?? null, reviewMessage: reviewMessage ?? null };
      });
      const incomingIds = new Set(normalized.rows.map(row => row.externalId));
      const referencedIds = new Set([...keepers, ...assignments, ...awards, ...picks].map(item => item.playerId));
      const omitted = players.filter(player => player.sourceNamespace === sourceNamespace && !player.custom && player.providerActive && player.externalId && !incomingIds.has(player.externalId) && referencedIds.has(player.id));
      let rowNumber = normalized.rows.length;
      for (const player of omitted) {
        rowNumber++;
        stagedRows.push({ id: randomUUID(), batchId: id, rowNumber, operation: "OMIT", externalId: player.externalId!, name: player.name, position: player.position as CanonicalCatalogRow["position"], nflTeam: player.nflTeam, providerStatus: player.providerStatus, providerActive: player.providerActive, leagueSelectable: player.leagueSelectable, sourceUpdatedAt: player.sourceUpdatedAt, aliasesJson: JSON.stringify(player.aliases.map(alias => ({ sourceNamespace: alias.sourceNamespace, sourceId: alias.sourceId }))), reviewKind: "SOURCE_OMISSION", reviewMessage: `${player.name} is absent from the new source but is referenced by season history` });
      }
      if (stagedRows.length) await database.catalogPreparationRow.createMany({ data: stagedRows });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
      return id;
    });
    return this.catalogPreparation(metadata.actor, metadata.seasonId, batchId);
  }

  async setCatalogDisposition(metadata: CommandMetadata, batchId: string, rowNumber: number, input: { disposition: CatalogDisposition; resolutionPlayerId?: string }): Promise<CatalogPreparationView> {
    await this.assertSetup(metadata.seasonId);
    await this.setupCommand(metadata, async database => {
      const batch = await database.catalogPreparationBatch.findFirst({ where: { id: batchId, seasonId: metadata.seasonId, state: "STAGED" } });
      if (!batch) throw new Error("Active catalog preparation not found");
      const row = await database.catalogPreparationRow.findUnique({ where: { batchId_rowNumber: { batchId, rowNumber } } });
      if (!row?.reviewKind) throw new Error("Catalog row does not require a disposition");
      if (input.disposition === "LINK_EXISTING") {
        if (!input.resolutionPlayerId) throw new Error("Linked disposition requires a player");
        const player = await database.player.findFirst({ where: { id: input.resolutionPlayerId, seasonId: metadata.seasonId } });
        if (!player) throw new Error("Resolution player not found");
      }
      const season = await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
      await database.catalogPreparationRow.update({ where: { batchId_rowNumber: { batchId, rowNumber } }, data: { disposition: input.disposition, resolutionPlayerId: input.resolutionPlayerId ?? null } });
      await database.catalogPreparationBatch.update({ where: { id: batchId }, data: { expectedSeasonVersion: season.rowVersion } });
    });
    return this.catalogPreparation(metadata.actor, metadata.seasonId, batchId);
  }

  async approveCatalog(metadata: CommandMetadata, batchId: string): Promise<{ batchId: string; promotedCount: number; normalizedHash: string }> {
    await this.assertSetup(metadata.seasonId);
    return this.setupCommand(metadata, async database => {
      const batch = await database.catalogPreparationBatch.findFirst({ where: { id: batchId, seasonId: metadata.seasonId }, include: { rows: { orderBy: { rowNumber: "asc" } } } });
      if (!batch || batch.state !== "STAGED") throw new Error("Active catalog preparation not found");
      if (batch.expiresAt && batch.expiresAt <= new Date()) throw new Error("Catalog preparation has expired");
      const season = await database.season.findUniqueOrThrow({ where: { id: metadata.seasonId } });
      if (batch.expectedSeasonVersion !== season.rowVersion) throw new Error(`Stale catalog batch: expected season version ${batch.expectedSeasonVersion}, found ${season.rowVersion}`);
      if (batch.rows.some(row => row.reviewKind && !row.disposition)) throw new Error("Catalog approval has unresolved review rows");
      const prior = await database.playerImportBatch.findFirst({ where: { seasonId: metadata.seasonId, sourceNamespace: batch.sourceNamespace, supersededAt: null }, orderBy: { createdAt: "desc" } });
      if (prior) {
        await database.playerImportBatch.update({ where: { id: prior.id }, data: { supersededAt: new Date() } });
        await database.catalogSnapshot.updateMany({ where: { id: prior.id, supersededAt: null }, data: { state: "SUPERSEDED", supersededAt: new Date() } });
      }
      await database.player.updateMany({ where: { seasonId: metadata.seasonId, sourceNamespace: batch.sourceNamespace, custom: false }, data: { providerStatus: "INACTIVE", providerActive: false, available: false } });
      await database.playerImportBatch.create({ data: { id: batch.id, seasonId: metadata.seasonId, sourceNamespace: batch.sourceNamespace, format: batch.format, sha256: batch.sourceHash, rowCount: batch.rowCount, supersedesId: prior?.id ?? null } });
      await database.catalogSnapshot.create({ data: { id: batch.id, seasonId: metadata.seasonId, sourceNamespace: batch.sourceNamespace, state: "APPROVED", sourceHash: batch.sourceHash, normalizedHash: batch.normalizedHash, approvedAt: new Date(), supersedesId: prior?.id ?? null } });
      const upserts = batch.rows.filter(row => row.operation === "UPSERT");
      const namespacePlayers = await database.player.findMany({ where: { seasonId: metadata.seasonId, sourceNamespace: batch.sourceNamespace, custom: false }, select: { externalId: true } });
      const freshPromotion = namespacePlayers.length === 0 && upserts.every(row => row.disposition !== "LINK_EXISTING");
      if (freshPromotion) {
        const playerRows = upserts.map(row => ({ id: randomUUID(), seasonId: metadata.seasonId, name: row.name, position: row.position, sourceType: "NFL", sourceNamespace: batch.sourceNamespace, externalId: row.externalId, nflTeam: row.nflTeam, providerStatus: row.providerStatus, providerActive: row.providerActive, leagueSelectable: row.leagueSelectable, normalizedSearchText: normalizeSearchText(row.name), sourceUpdatedAt: row.sourceUpdatedAt, catalogSnapshotId: batch.id, custom: false, explicitMinimumBid: null, available: row.providerActive && row.leagueSelectable, keeperEligible: false, activeImportBatchId: batch.id }));
        const ids = new Map(playerRows.map((player, index) => [upserts[index]!.rowNumber, player.id]));
        const aliasRows = upserts.flatMap(row => (JSON.parse(row.aliasesJson) as CanonicalCatalogRow["aliases"]).map(alias => ({ id: randomUUID(), seasonId: metadata.seasonId, playerId: ids.get(row.rowNumber)!, sourceNamespace: alias.sourceNamespace, sourceId: alias.sourceId })));
        if (aliasRows.length) {
          const stagedAliasKeys = new Set(aliasRows.map(alias => `${alias.sourceNamespace}\u0000${alias.sourceId}`));
          const collision = (await database.playerSourceAlias.findMany({ where: { seasonId: metadata.seasonId }, select: { sourceNamespace: true, sourceId: true } })).find(alias => stagedAliasKeys.has(`${alias.sourceNamespace}\u0000${alias.sourceId}`));
          if (collision) throw new Error(`Alias collision during promotion: ${collision.sourceNamespace}/${collision.sourceId}`);
        }
        if (playerRows.length) await database.player.createMany({ data: playerRows });
        if (aliasRows.length) await database.playerSourceAlias.createMany({ data: aliasRows });
      }
      for (const row of batch.rows) {
        if (row.operation === "OMIT") {
          if (row.disposition === "KEEP_ACTIVE") {
            const player = await database.player.findFirstOrThrow({ where: { seasonId: metadata.seasonId, sourceNamespace: batch.sourceNamespace, externalId: row.externalId } });
            const owned = Boolean(await database.rosterAssignment.findFirst({ where: { seasonId: metadata.seasonId, playerId: player.id, supersededAt: null }, select: { id: true } }));
            await database.player.update({ where: { id: player.id }, data: { providerStatus: row.providerStatus, providerActive: true, available: deriveAvailability({ owned, leagueSelectable: player.leagueSelectable, providerActive: true }).available } });
          }
          continue;
        }
        if (freshPromotion) continue;
        const aliases = JSON.parse(row.aliasesJson) as CanonicalCatalogRow["aliases"];
        let player = row.disposition === "LINK_EXISTING" && row.resolutionPlayerId ? await database.player.findFirst({ where: { id: row.resolutionPlayerId, seasonId: metadata.seasonId } }) : null;
        player ??= await database.player.findFirst({ where: { seasonId: metadata.seasonId, sourceNamespace: batch.sourceNamespace, externalId: row.externalId } });
        const owned = player ? Boolean(await database.rosterAssignment.findFirst({ where: { seasonId: metadata.seasonId, playerId: player.id, supersededAt: null }, select: { id: true } })) : false;
        const available = !owned && row.providerActive && row.leagueSelectable;
        const data = { name: row.name, position: row.position, nflTeam: row.nflTeam, providerStatus: row.providerStatus, providerActive: row.providerActive, leagueSelectable: row.leagueSelectable, normalizedSearchText: normalizeSearchText(row.name), sourceUpdatedAt: row.sourceUpdatedAt, activeImportBatchId: batch.id, catalogSnapshotId: batch.id, supersededAt: null, available };
        if (player) player = await database.player.update({ where: { id: player.id }, data });
        else player = await database.player.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, sourceType: "NFL", sourceNamespace: batch.sourceNamespace, externalId: row.externalId, custom: false, ...data } });
        for (const alias of aliases) {
          const existingAlias = await database.playerSourceAlias.findUnique({ where: { seasonId_sourceNamespace_sourceId: { seasonId: metadata.seasonId, sourceNamespace: alias.sourceNamespace, sourceId: alias.sourceId } } });
          if (existingAlias && existingAlias.playerId !== player.id) throw new Error(`Alias collision during promotion: ${alias.sourceNamespace}/${alias.sourceId}`);
          const namespaceAlias = await database.playerSourceAlias.findUnique({ where: { playerId_sourceNamespace: { playerId: player.id, sourceNamespace: alias.sourceNamespace } } });
          if (!existingAlias && !namespaceAlias) await database.playerSourceAlias.create({ data: { id: randomUUID(), seasonId: metadata.seasonId, playerId: player.id, sourceNamespace: alias.sourceNamespace, sourceId: alias.sourceId } });
        }
      }
      await database.catalogPreparationBatch.update({ where: { id: batch.id }, data: { state: "APPROVED", approvedAt: new Date() } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
      return { batchId: batch.id, promotedCount: batch.rows.filter(row => row.operation === "UPSERT").length, normalizedHash: batch.normalizedHash };
    });
  }

  async cancelCatalogPreparation(metadata: CommandMetadata, batchId: string): Promise<void> {
    await this.assertSetup(metadata.seasonId);
    await this.setupCommand(metadata, async database => {
      const changed = await database.catalogPreparationBatch.updateMany({ where: { id: batchId, seasonId: metadata.seasonId, state: "STAGED" }, data: { state: "CANCELLED" } });
      if (changed.count !== 1) throw new Error("Active catalog preparation not found");
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
    });
  }

  async setLeagueSelectability(metadata: CommandMetadata, playerId: string, leagueSelectable: boolean): Promise<void> {
    await this.assertSetup(metadata.seasonId);
    await this.setupCommand(metadata, async database => {
      const player = await database.player.findFirst({ where: { id: playerId, seasonId: metadata.seasonId } });
      if (!player) throw new Error("Player not found");
      const owned = Boolean(await database.rosterAssignment.findFirst({ where: { seasonId: metadata.seasonId, playerId, supersededAt: null }, select: { id: true } }));
      const availability = deriveAvailability({ owned, leagueSelectable, providerActive: player.providerActive });
      await database.player.update({ where: { id: playerId }, data: { leagueSelectable, available: availability.available } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
    });
  }

  async reviseCustomPlayer(metadata: CommandMetadata, playerId: string, input: { replacementId?: string; name: string; position: PlayerInput["position"] }): Promise<{ playerId: string; superseded: boolean }> {
    await this.assertSetup(metadata.seasonId);
    if (!input.name.trim() || !PLAYER_POSITIONS.includes(input.position)) throw new Error("Custom player name and known position are required");
    return this.setupCommand(metadata, async database => {
      const player = await database.player.findFirst({ where: { id: playerId, seasonId: metadata.seasonId, custom: true } });
      if (!player) throw new Error("Custom player not found");
      const referenced = Boolean(await database.keeperSelection.findFirst({ where: { playerId }, select: { id: true } })) || Boolean(await database.rosterAssignment.findFirst({ where: { seasonId: metadata.seasonId, playerId }, select: { id: true } }));
      if (!referenced) {
        await database.player.update({ where: { id: playerId }, data: { name: input.name.trim(), position: input.position, normalizedSearchText: normalizeSearchText(input.name) } });
        await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
        return { playerId, superseded: false };
      }
      const replacementId = input.replacementId ?? randomUUID();
      await database.player.update({ where: { id: playerId }, data: { providerStatus: "SUPERSEDED", providerActive: false, leagueSelectable: false, available: false, supersededAt: new Date() } });
      await database.player.create({ data: { id: replacementId, seasonId: metadata.seasonId, name: input.name.trim(), position: input.position, sourceType: "LEAGUE_CUSTOM", custom: true, normalizedSearchText: normalizeSearchText(input.name), providerStatus: "ACTIVE", providerActive: true, leagueSelectable: true, available: true, supersedesPlayerId: playerId } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
      return { playerId: replacementId, superseded: true };
    });
  }

  async pricePreparation(_actor: ActorDescriptor, seasonId: string, batchId: string): Promise<PricePreparationView> {
    const batch=await this.prisma.pricePreparationBatch.findFirst({where:{id:batchId,seasonId},include:{rows:{orderBy:{rowNumber:"asc"}}}});if(!batch)throw new Error("Price preparation not found");const rows=batch.rows.map(row=>({rowNumber:row.rowNumber,name:row.name,minimumBid:row.minimumBid,matchKind:row.matchKind as PricePreparationView["rows"][number]["matchKind"],...(row.matchedPlayerId?{matchedPlayerId:row.matchedPlayerId}:{}),...(row.disposition?{disposition:row.disposition}:{}),...(row.resolutionPlayerId?{resolutionPlayerId:row.resolutionPlayerId}:{}),...(row.reviewMessage?{reviewMessage:row.reviewMessage}:{})}));return{id:batch.id,sourceLabel:batch.sourceLabel,state:batch.state,expectedSeasonVersion:batch.expectedSeasonVersion,rowCount:batch.rowCount,unresolvedCount:rows.filter(row=>row.matchKind!=="STABLE_ID"&&!row.disposition).length,rows};
  }
  async stagePriceList(metadata:CommandMetadata,sourceLabel:string,format:PriceListFormat,normalized:NormalizedPriceList):Promise<PricePreparationView>{await this.assertSetup(metadata.seasonId);if(!sourceLabel.trim())throw new Error("Price source label is required");const prior=await this.prisma.pricePreparationBatch.findUnique({where:{seasonId_sourceHash:{seasonId:metadata.seasonId,sourceHash:normalized.sourceHash}}});if(prior)return this.pricePreparation(metadata.actor,metadata.seasonId,prior.id);const id=await this.setupCommand(metadata,async database=>{const season=await database.season.findUniqueOrThrow({where:{id:metadata.seasonId}});const players=await database.player.findMany({where:{seasonId:metadata.seasonId},include:{aliases:true}});const batchId=randomUUID();await database.pricePreparationBatch.create({data:{id:batchId,seasonId:metadata.seasonId,sourceLabel:sourceLabel.trim(),format,sourceHash:normalized.sourceHash,normalizedHash:normalized.normalizedHash,expectedSeasonVersion:season.rowVersion+1,state:"STAGED",rowCount:normalized.rows.length}});const rows=normalized.rows.map(row=>{const stable=row.sourceNamespace&&row.sourceId?players.find(player=>player.aliases.some(alias=>alias.sourceNamespace===row.sourceNamespace&&alias.sourceId===row.sourceId)):undefined;const candidates=players.filter(player=>normalizeSearchText(player.name)===normalizeSearchText(row.name)&&player.position===row.position&&(!row.nflTeam||player.nflTeam===row.nflTeam));const matched=stable??(candidates.length===1?candidates[0]:undefined);const matchKind=stable?"STABLE_ID":candidates.length===1?"CONTEXT_PROPOSAL":candidates.length>1?"AMBIGUOUS":"UNMATCHED";return{id:randomUUID(),batchId,rowNumber:row.rowNumber,sourceNamespace:row.sourceNamespace??null,sourceId:row.sourceId??null,name:row.name,nflTeam:row.nflTeam??null,position:row.position,minimumBid:row.minimumBid,matchKind,matchedPlayerId:matched?.id??null,resolutionPlayerId:stable?.id??null,disposition:stable?"AUTO":null,reviewMessage:matchKind==="CONTEXT_PROPOSAL"?`Confirm ${matched!.name}`:matchKind==="AMBIGUOUS"?"Multiple players match this row":matchKind==="UNMATCHED"?"No player matches this row":null};});if(rows.length)await database.pricePreparationRow.createMany({data:rows});await database.season.update({where:{id:metadata.seasonId},data:{rowVersion:{increment:1}}});return batchId;});return this.pricePreparation(metadata.actor,metadata.seasonId,id);}
  async setPriceDisposition(metadata:CommandMetadata,batchId:string,rowNumber:number,resolutionPlayerId:string):Promise<PricePreparationView>{await this.assertSetup(metadata.seasonId);await this.setupCommand(metadata,async database=>{const batch=await database.pricePreparationBatch.findFirst({where:{id:batchId,seasonId:metadata.seasonId,state:"STAGED"}});if(!batch)throw new Error("Active price preparation not found");const player=await database.player.findFirst({where:{id:resolutionPlayerId,seasonId:metadata.seasonId}});if(!player)throw new Error("Resolution player not found");const season=await database.season.update({where:{id:metadata.seasonId},data:{rowVersion:{increment:1}}});await database.pricePreparationRow.update({where:{batchId_rowNumber:{batchId,rowNumber}},data:{disposition:"ACCEPT_MATCH",resolutionPlayerId}});await database.pricePreparationBatch.update({where:{id:batchId},data:{expectedSeasonVersion:season.rowVersion}});});return this.pricePreparation(metadata.actor,metadata.seasonId,batchId);}
  private async recomputePriceProjection(database:any,seasonId:string,playerIds:string[]){const floors=new Map((await database.positionPriceFloor.findMany({where:{seasonId,supersededAt:null}})).map((floor:any)=>[floor.position,floor.minimumBid]));for(const playerId of playerIds){const player=await database.player.findUniqueOrThrow({where:{id:playerId}});const assignments=await database.playerPriceAssignment.findMany({where:{seasonId,playerId,active:true},orderBy:{createdAt:"desc"}});const assignment=assignments.find((item:any)=>item.sourceType==="MANUAL")??assignments.find((item:any)=>item.sourceType==="LIST")??assignments.find((item:any)=>item.sourceType==="LEGACY");await database.player.update({where:{id:playerId},data:{explicitMinimumBid:assignment?.minimumBid??null}});if(!assignment&&!floors.has(player.position))continue;}}
  async approvePriceList(metadata:CommandMetadata,batchId:string):Promise<{batchId:string;assignedCount:number}>{await this.assertSetup(metadata.seasonId);return this.setupCommand(metadata,async database=>{const batch=await database.pricePreparationBatch.findFirst({where:{id:batchId,seasonId:metadata.seasonId},include:{rows:true}});if(!batch||batch.state!=="STAGED")throw new Error("Active price preparation not found");const season=await database.season.findUniqueOrThrow({where:{id:metadata.seasonId}});if(batch.expectedSeasonVersion!==season.rowVersion)throw new Error("Stale price batch");if(batch.rows.some(row=>row.matchKind!=="STABLE_ID"&&!row.disposition))throw new Error("Price approval has unresolved rows");const resolved=batch.rows.map(row=>({row,playerId:row.resolutionPlayerId??row.matchedPlayerId}));if(resolved.some(item=>!item.playerId))throw new Error("Price row has no resolved player");if(new Set(resolved.map(item=>item.playerId)).size!==resolved.length)throw new Error("Multiple price rows resolve to one player");await database.playerPriceAssignment.updateMany({where:{seasonId:metadata.seasonId,sourceType:"LIST",active:true},data:{active:false,supersededAt:new Date()}});await database.pricePreparationBatch.updateMany({where:{seasonId:metadata.seasonId,state:"APPROVED",supersededAt:null},data:{state:"SUPERSEDED",supersededAt:new Date()}});await database.playerPriceAssignment.createMany({data:resolved.map(({row,playerId})=>({id:randomUUID(),seasonId:metadata.seasonId,playerId:playerId!,minimumBid:row.minimumBid,sourceType:"LIST",sourceLabel:batch.sourceLabel,sourceBatchId:batch.id,active:true}))});const allPlayers=(await database.player.findMany({where:{seasonId:metadata.seasonId},select:{id:true}})).map(item=>item.id);await this.recomputePriceProjection(database,metadata.seasonId,allPlayers);await database.pricePreparationBatch.update({where:{id:batch.id},data:{state:"APPROVED",approvedAt:new Date()}});await database.season.update({where:{id:metadata.seasonId},data:{rowVersion:{increment:1}}});return{batchId,assignedCount:resolved.length};});}
  async setManualPrice(metadata:CommandMetadata,playerId:string,minimumBid?:number):Promise<void>{await this.assertSetup(metadata.seasonId);if(minimumBid!==undefined)positiveDollar(minimumBid,"Manual minimum");await this.setupCommand(metadata,async database=>{const player=await database.player.findFirst({where:{id:playerId,seasonId:metadata.seasonId}});if(!player)throw new Error("Player not found");await database.playerPriceAssignment.updateMany({where:{seasonId:metadata.seasonId,playerId,sourceType:{in:["MANUAL","LEGACY"]},active:true},data:{active:false,supersededAt:new Date()}});if(minimumBid!==undefined)await database.playerPriceAssignment.create({data:{id:randomUUID(),seasonId:metadata.seasonId,playerId,minimumBid,sourceType:"MANUAL",sourceLabel:"Commissioner override"}});await this.recomputePriceProjection(database,metadata.seasonId,[playerId]);await database.season.update({where:{id:metadata.seasonId},data:{rowVersion:{increment:1}}});});}
  async pricingSummary(_actor:ActorDescriptor,seasonId:string):Promise<PricingSummary>{const[players,floors,assignments,unresolved]=await Promise.all([this.prisma.player.findMany({where:{seasonId},orderBy:[{name:"asc"},{id:"asc"}]}),this.prisma.positionPriceFloor.findMany({where:{seasonId,supersededAt:null}}),this.prisma.playerPriceAssignment.findMany({where:{seasonId,active:true},orderBy:{createdAt:"desc"}}),this.prisma.pricePreparationBatch.count({where:{seasonId,state:"STAGED"}})]);const floorMap=Object.fromEntries(floors.map(floor=>[floor.position,floor.minimumBid]));const priced:PricingSummary["players"]=players.map(player=>{const own=assignments.filter(item=>item.playerId===player.id);const assignment=own.find(item=>item.sourceType==="MANUAL")??own.find(item=>item.sourceType==="LIST")??own.find(item=>item.sourceType==="LEGACY");const floor=floorMap[player.position];return{playerId:player.id,name:player.name,position:player.position,...(assignment?{minimumBid:assignment.minimumBid,source:assignment.sourceType as "MANUAL"|"LIST"|"LEGACY",sourceLabel:assignment.sourceLabel}:floor!==undefined?{minimumBid:floor,source:"FLOOR" as const,sourceLabel:`${player.position} floor`}:{source:"MISSING" as const,sourceLabel:"Missing price"})};});return{floors:floorMap,players:priced,preflight:{pricedCount:priced.filter(item=>item.minimumBid!==undefined).length,missingCount:priced.filter(item=>item.minimumBid===undefined).length,unresolvedBatchCount:unresolved}};}

  async setPriceFloors(metadata: CommandMetadata, floors: Record<string, number>): Promise<void> {
    await this.assertSetup(metadata.seasonId);
    for (const [position, floor] of Object.entries(floors)) { if (!PLAYER_POSITIONS.includes(position as never)) throw new Error(`Unknown position: ${position}`); positiveDollar(floor, `${position} minimum`); }
    await this.setupCommand(metadata, async database => {
      await database.positionPriceFloor.updateMany({ where: { seasonId: metadata.seasonId, supersededAt: null }, data: { supersededAt: new Date() } });
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
        const player = await requireSelectablePlayer(database, metadata.seasonId, playerId);
        if (!player.keeperEligible) throw new Error("Keeper player is unavailable");
        const existing = await database.keeperSelection.findFirst({ where: { seasonId: metadata.seasonId, playerId, seasonTeamId: { not: seasonTeamId } }, include: { seasonTeam: true } });
        if (existing) throw new Error(`Keeper player is already selected by ${existing.seasonTeam.displayName}`);
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
    if (await this.prisma.pricePreparationBatch.count({ where: { seasonId: metadata.seasonId, state: "STAGED" } })) throw new Error("Price-list review must be resolved before keeper lock");
    if (!Number.isInteger(rosterCapacity) || rosterCapacity < 1) throw new Error("Roster capacity must be positive");
    const summary = await this.setupSummary(metadata.actor, metadata.seasonId);
    const playersById = new Map(summary.players.map(player => [player.id, player]));
    const invalidKeeper = summary.teams.some(team => {
      if (!team.keeperPlayerId) return false;
      const player = playersById.get(team.keeperPlayerId);
      return !player || !player.available || !player.keeperEligible || player.minimumBid === undefined;
    });
    if (invalidKeeper) throw new Error("Invalid keeper selection must be changed or cleared before keeper lock");
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
      this.prisma.positionPriceFloor.findMany({ where: { seasonId, supersededAt: null } }),
    ]);
    const floorMap = Object.fromEntries(floors.map(floor => [floor.position, floor.minimumBid]));
    return { season, teams: teams.map(team => ({ id: team.teamId, seasonTeamId: team.id, displayName: team.displayName, seedOrder: team.seedOrder, ...(team.keeper ? { keeperPlayerId: team.keeper.playerId } : {}), startingBudget: team.keeper ? 300 : 350 })), players: players.map(player => { const minimumBid = player.explicitMinimumBid ?? floorMap[player.position]; return ({ id: player.id, name: player.name, position: player.position as PlayerInput["position"], sourceType: player.sourceType as PlayerInput["sourceType"], ...(player.sourceNamespace ? { sourceNamespace: player.sourceNamespace } : {}), ...(player.externalId ? { externalId: player.externalId } : {}), ...(player.explicitMinimumBid == null ? {} : { explicitMinimumBid: player.explicitMinimumBid }), ...(minimumBid === undefined ? {} : { minimumBid }), available: player.available, keeperEligible: player.keeperEligible }); }), floors: floorMap };
  }

  async keeperSummary(actor: ActorDescriptor, seasonId: string): Promise<KeeperStageSummary> {
    const season = await this.getSeason(actor, seasonId);
    if (!season) throw new Error(`Season not found: ${seasonId}`);
    const [teams, floors, unresolvedPriceReviewCount] = await Promise.all([
      this.prisma.seasonTeam.findMany({ where: { seasonId }, include: { keeper: true }, orderBy: { seedOrder: "asc" } }),
      this.prisma.positionPriceFloor.findMany({ where: { seasonId, supersededAt: null } }),
      this.prisma.pricePreparationBatch.count({ where: { seasonId, state: "STAGED" } }),
    ]);
    const selectedPlayerIds = teams.flatMap(team => team.keeper ? [team.keeper.playerId] : []);
    const players = await this.prisma.player.findMany({
      where: { seasonId, OR: [{ keeperEligible: true }, { id: { in: selectedPlayerIds } }] },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const playerIds = players.map(player => player.id);
    const floorMap = new Map(floors.map(floor => [floor.position, floor.minimumBid]));
    const [priceAssignments, rosterAssignments, missingPriceCount] = await Promise.all([
      this.prisma.playerPriceAssignment.findMany({ where: { seasonId, playerId: { in: playerIds }, active: true }, orderBy: { createdAt: "desc" } }),
      this.prisma.rosterAssignment.findMany({ where: { seasonId, playerId: { in: playerIds }, supersededAt: null }, select: { playerId: true } }),
      this.prisma.player.count({ where: { seasonId, explicitMinimumBid: null, position: { notIn: [...floorMap.keys()] } } }),
    ]);
    const assignmentsByPlayer = new Map<string, typeof priceAssignments>();
    for (const assignment of priceAssignments) {
      const assignments = assignmentsByPlayer.get(assignment.playerId) ?? [];
      assignments.push(assignment);
      assignmentsByPlayer.set(assignment.playerId, assignments);
    }
    const ownedPlayerIds = new Set(rosterAssignments.map(assignment => assignment.playerId));
    const locked = season.state !== LifecycleState.SETUP;
    const historicalKeeperIds = new Set(selectedPlayerIds);
    const stagePlayers = new Map(players.map(player => {
      const assignments = assignmentsByPlayer.get(player.id) ?? [];
      const price = assignments.find(item => item.sourceType === "MANUAL")
        ?? assignments.find(item => item.sourceType === "LIST")
        ?? assignments.find(item => item.sourceType === "LEGACY");
      const floor = floorMap.get(player.position);
      const minimumBid = price?.minimumBid ?? floor;
      const availability = deriveAvailability({ owned: ownedPlayerIds.has(player.id), leagueSelectable: player.leagueSelectable, providerActive: player.providerActive });
      const stagePlayer: KeeperStagePlayer = {
        id: player.id,
        name: player.name,
        position: player.position,
        ...(player.nflTeam ? { nflTeam: player.nflTeam } : {}),
        sourceType: player.sourceType as KeeperStagePlayer["sourceType"],
        providerActive: player.providerActive,
        leagueSelectable: player.leagueSelectable,
        keeperEligible: player.keeperEligible,
        available: availability.available,
        availabilityReason: availability.reason,
        ...(minimumBid === undefined ? {} : { minimumBid }),
        priceSourceLabel: price?.sourceLabel ?? (floor === undefined ? "Missing price" : `${player.position} floor`),
        valid: (locked && historicalKeeperIds.has(player.id)) || (player.keeperEligible && availability.available && minimumBid !== undefined),
      };
      return [player.id, stagePlayer] as const;
    }));
    const toStagePlayer = (playerId: string): KeeperStagePlayer => {
      const player = stagePlayers.get(playerId);
      if (!player) throw new Error(`Selected keeper is missing from the season catalog: ${playerId}`);
      return {
        ...player,
      };
    };
    const teamSummaries = teams.map(team => {
      const selected = team.keeper ? toStagePlayer(team.keeper.playerId) : undefined;
      return {
        id: team.teamId,
        seasonTeamId: team.id,
        displayName: team.displayName,
        seedOrder: team.seedOrder,
        keeperCost: selected ? 50 as const : 0 as const,
        startingBudget: selected ? 300 as const : 350 as const,
        ...(selected ? { selectedPlayer: selected } : {}),
      };
    });
    const missingTeamCount = Math.max(0, season.teamCount - teamSummaries.length);
    const invalidSelectionCount = teamSummaries.filter(team => team.selectedPlayer && !team.selectedPlayer.valid).length;
    return {
      season,
      locked,
      keeperCost: 50,
      eligiblePlayers: [...stagePlayers.values()].filter(player => player.keeperEligible),
      teams: teamSummaries,
      preflight: {
        expectedTeamCount: season.teamCount,
        configuredTeamCount: teamSummaries.length,
        missingTeamCount,
        invalidSelectionCount,
        missingPriceCount,
        unresolvedPriceReviewCount,
        canLock: !locked && missingTeamCount === 0 && invalidSelectionCount === 0 && missingPriceCount === 0 && unresolvedPriceReviewCount === 0,
      },
    };
  }

  async catalogPlayers(_actor: ActorDescriptor, seasonId: string, query: CatalogQuery = {}): Promise<CatalogPlayer[]> {
    const rows = await this.prisma.player.findMany({
      where: {
        seasonId,
        ...(query.search ? { normalizedSearchText: { contains: normalizeSearchText(query.search) } } : {}),
        ...(query.nflTeam ? { nflTeam: query.nflTeam.toUpperCase() } : {}),
        ...(query.position ? { position: query.position.toUpperCase() } : {}),
        ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      },
      include: { aliases: { orderBy: [{ sourceNamespace: "asc" }, { sourceId: "asc" }] } },
      orderBy: [{ normalizedSearchText: "asc" }, { id: "asc" }],
    });
    const assignments = await this.prisma.rosterAssignment.findMany({ where: { seasonId, supersededAt: null }, select: { playerId: true } });
    const ownedIds = new Set(assignments.map(item => item.playerId));
    return rows.flatMap(row => {
      const availability = deriveAvailability({ owned: ownedIds.has(row.id), leagueSelectable: row.leagueSelectable, providerActive: row.providerActive });
      if (query.availability && availability.reason !== query.availability) return [];
      return [{
        id: row.id, name: row.name, position: row.position,
        ...(row.nflTeam ? { nflTeam: row.nflTeam } : {}), sourceType: row.sourceType,
        providerStatus: row.providerStatus, providerActive: row.providerActive, leagueSelectable: row.leagueSelectable, keeperEligible: row.keeperEligible,
        normalizedSearchText: row.normalizedSearchText, ...(row.sourceUpdatedAt ? { sourceUpdatedAt: row.sourceUpdatedAt } : {}),
        aliases: row.aliases.map(alias => ({ sourceNamespace: alias.sourceNamespace, sourceId: alias.sourceId })),
        owned: ownedIds.has(row.id), ...availability,
      }];
    });
  }

  async searchCatalogPlayers(_actor: ActorDescriptor, seasonId: string, query: PlayerSearchQuery = {}): Promise<PlayerSearchPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    if (!Number.isSafeInteger(page) || page < 1) throw Object.assign(new Error("Page must be a positive integer"), { statusCode: 400 });
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw Object.assign(new Error("Page size must be between 1 and 100"), { statusCode: 400 });

    const where: Record<string, unknown> = { seasonId };
    if (query.search) where.normalizedSearchText = { contains: normalizeSearchText(query.search) };
    if (query.nflTeam) where.nflTeam = query.nflTeam.toUpperCase();
    if (query.position) where.position = query.position.toUpperCase();
    if (query.sourceType) where.sourceType = query.sourceType;

    if (query.availability === "OWNED" || query.availability === "LEAGUE_DISABLED" || query.availability === "CATALOG_INACTIVE") {
      const assignments = await this.prisma.rosterAssignment.findMany({ where: { seasonId, supersededAt: null }, select: { playerId: true } });
      const ownedPlayerIds = assignments.map(item => item.playerId);
      where.id = query.availability === "OWNED" ? { in: ownedPlayerIds } : { notIn: ownedPlayerIds };
    }
    if (query.availability === "LEAGUE_DISABLED") {
      where.leagueSelectable = false;
    } else if (query.availability === "CATALOG_INACTIVE") {
      where.leagueSelectable = true;
      where.providerActive = false;
    } else if (query.availability === "AVAILABLE" || (!query.availability && !query.includeUnavailable)) {
      where.available = true;
      if (query.stagePolicy === "KEEPER") where.keeperEligible = true;
    }

    const [total, players] = await Promise.all([
      this.prisma.player.count({ where }),
      this.prisma.player.findMany({
        where,
        include: { aliases: { orderBy: [{ sourceNamespace: "asc" }, { sourceId: "asc" }] } },
        orderBy: [{ normalizedSearchText: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    if (players.length === 0) return { page, pageSize, total, totalPages: Math.ceil(total / pageSize), items: [] };

    const playerIds = players.map(player => player.id);
    const positions = [...new Set(players.map(player => player.position))];
    const [priceAssignments, floors, assignments] = await Promise.all([
      this.prisma.playerPriceAssignment.findMany({ where: { seasonId, playerId: { in: playerIds }, active: true }, orderBy: { createdAt: "desc" } }),
      this.prisma.positionPriceFloor.findMany({ where: { seasonId, position: { in: positions }, supersededAt: null } }),
      this.prisma.rosterAssignment.findMany({ where: { seasonId, playerId: { in: playerIds }, supersededAt: null } }),
    ]);
    const teamIds = [...new Set(assignments.map(item => item.seasonTeamId))];
    const teams = teamIds.length === 0 ? [] : await this.prisma.seasonTeam.findMany({ where: { seasonId, id: { in: teamIds } } });

    const pricesByPlayer = new Map<string, typeof priceAssignments>();
    for (const assignment of priceAssignments) {
      const prices = pricesByPlayer.get(assignment.playerId) ?? [];
      prices.push(assignment);
      pricesByPlayer.set(assignment.playerId, prices);
    }
    const floorMap = new Map(floors.map(floor => [floor.position, floor.minimumBid]));
    const teamNames = new Map(teams.map(team => [team.id, team.displayName]));
    const owners = new Map(assignments.map(item => [item.playerId, teamNames.get(item.seasonTeamId) ?? "Owned"]));

    const items = players.map(player => {
      const prices = pricesByPlayer.get(player.id) ?? [];
      const price = prices.find(item => item.sourceType === "MANUAL")
        ?? prices.find(item => item.sourceType === "LIST")
        ?? prices.find(item => item.sourceType === "LEGACY");
      const floor = floorMap.get(player.position);
      const availability = deriveAvailability({ owned: owners.has(player.id), leagueSelectable: player.leagueSelectable, providerActive: player.providerActive });
      const stageAllowed = query.stagePolicy === "KEEPER"
        ? availability.available && player.keeperEligible
        : query.stagePolicy === "SETUP" ? !owners.has(player.id) : availability.available;
      const priceContext = price
        ? { minimumBid: price.minimumBid, priceSource: price.sourceType as "MANUAL" | "LIST" | "LEGACY", priceSourceLabel: price.sourceLabel }
        : floor !== undefined
          ? { minimumBid: floor, priceSource: "FLOOR" as const, priceSourceLabel: `${player.position} floor` }
          : { priceSource: "MISSING" as const, priceSourceLabel: "Missing price" };

      return {
        id: player.id,
        name: player.name,
        position: player.position,
        ...(player.nflTeam ? { nflTeam: player.nflTeam } : {}),
        sourceType: player.sourceType,
        providerStatus: player.providerStatus,
        providerActive: player.providerActive,
        leagueSelectable: player.leagueSelectable,
        keeperEligible: player.keeperEligible,
        normalizedSearchText: player.normalizedSearchText,
        ...(player.sourceUpdatedAt ? { sourceUpdatedAt: player.sourceUpdatedAt } : {}),
        aliases: player.aliases.map(alias => ({ sourceNamespace: alias.sourceNamespace, sourceId: alias.sourceId })),
        owned: owners.has(player.id),
        ...availability,
        ...priceContext,
        ...(owners.has(player.id) ? { ownerLabel: owners.get(player.id)! } : {}),
        availabilityReason: availability.reason,
        stageAllowed,
      };
    });
    return { page, pageSize, total, totalPages: Math.ceil(total / pageSize), items };
  }

  async assertAvailabilityConsistency(seasonId: string): Promise<void> {
    const rows = await this.catalogPlayers({ type: "SYSTEM", label: "availability-consistency" }, seasonId);
    const contradictions = rows.filter(row => row.available !== (row.reason === "AVAILABLE"));
    const persisted = await this.prisma.player.findMany({ where: { seasonId }, select: { id: true, available: true } });
    const derived = new Map(rows.map(row => [row.id, row.available]));
    contradictions.push(...persisted.filter(row => derived.get(row.id) !== row.available).map(row => rows.find(item => item.id === row.id)!).filter(Boolean));
    if (contradictions.length) throw new Error(`Player availability compatibility projection is inconsistent: ${[...new Set(contradictions.map(row => row.id))].join(", ")}`);
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
      if (submission.status === "FINAL") throw new Error("Finalized submission cannot be edited");
      const team = await database.seasonTeam.findUniqueOrThrow({ where: { id: seasonTeamId } });
      if (team.seasonId !== metadata.seasonId) throw new Error("Team does not belong to season");
      const seen = new Set<string>();
      const balance = bids.length === 0 ? null : await database.teamAuctionBalance.findUniqueOrThrow({ where: { seasonId_seasonTeamId_roundNumber: { seasonId: metadata.seasonId, seasonTeamId, roundNumber } } });
      const floors = bids.length === 0 ? new Map<string, number>() : new Map((await database.positionPriceFloor.findMany({ where: { seasonId: metadata.seasonId, supersededAt: null } })).map(floor => [floor.position, floor.minimumBid]));
      for (const bid of bids) {
        if (seen.has(bid.playerId)) throw new Error("A team cannot bid on the same player twice"); seen.add(bid.playerId);
        const player = await requireSelectablePlayer(database, metadata.seasonId, bid.playerId);
        const minimumBid = player.explicitMinimumBid ?? floors.get(player.position);
        if (minimumBid === undefined || bid.amount < minimumBid) throw new Error(`Bid for ${player.name} is below the $${minimumBid ?? "missing"} minimum`);
        if (balance && bid.amount > balance.startingBudget) throw new Error(`Bid for ${player.name} exceeds the $${balance.startingBudget} team budget`);
      }
      const encoded = bids.map((bid, index) => ({ bidId: `${submission.id}:${index + 1}`, priority: (index + 1) as 1 | 2 | 3, ...bid }));
      await database.auctionSubmission.update({ where: { id: submission.id }, data: { bidsJson: JSON.stringify(encoded), bidCount: bids.length, status: finalize ? "FINAL" : "DRAFT", zeroConfirmed: bids.length === 0 && confirmZero } });
      await database.season.update({ where: { id: metadata.seasonId }, data: { rowVersion: { increment: 1 } } });
    });
  }

  async submission(_actor: ActorDescriptor, seasonId: string, roundNumber: AuctionRoundNumber, seasonTeamId: string) {
    const round = await this.prisma.auctionRound.findFirstOrThrow({ where: { seasonId, roundNumber, supersededAt: null } });
    const team = await this.prisma.seasonTeam.findFirst({ where: { id: seasonTeamId, seasonId, active: true } });
    if (!team) throw new Error("Team does not belong to season");
    const submission = await this.prisma.auctionSubmission.findUniqueOrThrow({ where: { roundId_seasonTeamId: { roundId: round.id, seasonTeamId } } });
    const bids = JSON.parse(submission.bidsJson) as SavedAuctionBid[];
    const players = bids.length ? await this.prisma.player.findMany({ where: { seasonId, id: { in: bids.map(bid => bid.playerId) } } }) : [];
    const floors = bids.length ? await this.prisma.positionPriceFloor.findMany({ where: { seasonId, supersededAt: null } }) : [];
    const playersById = new Map(players.map(player => [player.id, player]));
    const floorByPosition = new Map(floors.map(floor => [floor.position, floor.minimumBid]));
    return { seasonTeamId, status: submission.status as AuctionSubmissionStatus, bidCount: submission.bidCount, zeroConfirmed: submission.zeroConfirmed, bids: bids.map(bid => { const player = playersById.get(bid.playerId); if (!player) throw new Error(`Saved bid player is missing: ${bid.playerId}`); const minimumBid = player.explicitMinimumBid ?? floorByPosition.get(player.position); return { ...bid, playerName: player.name, position: player.position, ...(minimumBid === undefined ? {} : { minimumBid }) }; }) };
  }

  async finalizeSubmission(metadata: CommandMetadata, roundNumber: AuctionRoundNumber, seasonTeamId: string, confirmZero: boolean): Promise<void> {
    await this.setupCommand(metadata, async database => {
      const round = await database.auctionRound.findFirstOrThrow({ where: { seasonId: metadata.seasonId, roundNumber, supersededAt: null } });
      if (round.status !== "BIDDING") throw new Error("Locked auction input is immutable");
      const team = await database.seasonTeam.findFirst({ where: { id: seasonTeamId, seasonId: metadata.seasonId, active: true } });
      if (!team) throw new Error("Team does not belong to season");
      const submission = await database.auctionSubmission.findUniqueOrThrow({ where: { roundId_seasonTeamId: { roundId: round.id, seasonTeamId } } });
      if (submission.status === "FINAL") throw new Error("Submission is already finalized");
      if (submission.bidCount === 0 && !confirmZero) throw new Error("Zero bids require confirmation");
      await database.auctionSubmission.update({ where: { id: submission.id }, data: { status: "FINAL", zeroConfirmed: submission.bidCount === 0 && confirmZero } });
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
      database.seasonTeam.findMany({ where: { seasonId, active: true }, orderBy: { seedOrder: "asc" } }), database.player.findMany({ where: { seasonId } }), database.positionPriceFloor.findMany({ where: { seasonId, supersededAt: null } }), database.auctionSubmission.findMany({ where: { roundId: round.id } }), database.teamAuctionBalance.findMany({ where: { seasonId, roundNumber } }), database.rosterAssignment.findMany({ where: { seasonId, supersededAt: null } }),
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
      const decisions = await database.draftOrderTieDecision.findMany({ where: { conventionalDraftId: draft.id, supersededAt: null } });
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
      const order = await database.draftOrderEntry.findMany({ where: { conventionalDraftId: draft.id, supersededAt: null }, orderBy: { orderPosition: "asc" } }); const pickCount = await database.draftPick.count({ where: { conventionalDraftId: draft.id, active: true } });
      const current = order[pickCount % order.length]; if (!current || current.seasonTeamId !== input.seasonTeamId) throw new Error("Only the team currently on the clock may pick");
      const player = await requireSelectablePlayer(database, metadata.seasonId, input.playerId);
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
    const draft = await this.prisma.conventionalDraft.findUniqueOrThrow({ where: { seasonId } });
    const [entries, teams, balances, decisions, pickRows, assignments] = await Promise.all([
      this.prisma.draftOrderEntry.findMany({ where: { conventionalDraftId: draft.id, supersededAt: null }, orderBy: { orderPosition: "asc" } }),
      this.prisma.seasonTeam.findMany({ where: { seasonId, active: true }, orderBy: { seedOrder: "asc" } }),
      this.prisma.teamAuctionBalance.findMany({ where: { seasonId, roundNumber: 2 } }),
      this.prisma.draftOrderTieDecision.findMany({ where: { conventionalDraftId: draft.id, supersededAt: null } }),
      this.prisma.draftPick.findMany({ where: { conventionalDraftId: draft.id, active: true }, orderBy: { overallPick: "desc" } }),
      this.prisma.rosterAssignment.findMany({ where: { seasonId, supersededAt: null } }),
    ]);
    const rosterPlayerIds = [...new Set([...assignments.map(item => item.playerId), ...pickRows.map(item => item.playerId)])];
    const players = await this.prisma.player.findMany({ where: { seasonId, id: { in: rosterPlayerIds } } });
    const names = new Map(teams.map(team => [team.id, team.displayName]));
    const playerById = new Map(players.map(player => [player.id, player]));
    const pickByPlayerId = new Map(pickRows.map(pick => [pick.playerId, pick]));
    const decided = new Set(decisions.map(item => item.balance));
    const ties = [...groupBalances(balances)].filter(([balance, group]) => group.length > 1 && !decided.has(balance)).map(([balance, group]) => ({ balance, seasonTeamIds: group.map(item => item.seasonTeamId) }));
    const pickCount = pickRows.length;
    const current = entries.length ? entries[pickCount % entries.length]?.seasonTeamId : undefined;
    const rosterRules = { limits: { QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 }, flexEligible: ["RB", "WR", "TE"], flexCapacity: 1 };
    const teamModels = teams.map(team => {
      const teamAssignments = assignments.filter(item => item.seasonTeamId === team.id);
      const positions = teamAssignments.map(item => playerById.get(item.playerId)?.position).filter((position): position is string => Boolean(position));
      const positionCounts = Object.fromEntries(PLAYER_POSITIONS.map(position => [position, positions.filter(value => value === position).length]));
      const legalNextPositions = PLAYER_POSITIONS.filter(position => canAddPlayerThroughPhase1(positions, position, rosterRules).legal);
      return { seasonTeamId: team.id, displayName: team.displayName, roster: teamAssignments.map(assignment => { const player = playerById.get(assignment.playerId)!; const pick = pickByPlayerId.get(assignment.playerId); return { playerId: player.id, playerName: player.name, position: player.position, acquisitionSource: assignment.acquisitionSource, ...(assignment.cost === null ? {} : { cost: assignment.cost }), ...(assignment.auctionRound === null ? {} : { auctionRound: assignment.auctionRound }), ...(pick ? { overallPick: pick.overallPick } : {}) }; }), positionCounts, openSlots: Math.max(0, 14 - teamAssignments.length), legalNextPositions };
    });
    return { status: draft.status as DraftOrderSummary["status"], ties, order: entries.map(item => ({ orderPosition: item.orderPosition, seasonTeamId: item.seasonTeamId, displayName: names.get(item.seasonTeamId)!, remainingBalance: item.remainingBalance })), nextOverallPick: pickCount + 1, currentRound: entries.length ? Math.floor(pickCount / entries.length) + 1 : 1, filledRosterSlots: assignments.length, totalRosterSlots: teams.length * 14, teams: teamModels, history: pickRows.map(pick => { const player = playerById.get(pick.playerId)!; return { overallPick: pick.overallPick, roundNumber: pick.roundNumber, orderPosition: pick.orderPosition, seasonTeamId: pick.seasonTeamId, displayName: names.get(pick.seasonTeamId)!, playerId: player.id, playerName: player.name, position: player.position }; }), ...(current && draft.status !== "COMPLETED" ? { currentSeasonTeamId: current } : {}) };
  }


  async summary(_actor: ActorDescriptor, seasonId: string, roundNumber: AuctionRoundNumber, reveal = false): Promise<AuctionRoundSummary> {
    const round = await this.prisma.auctionRound.findFirstOrThrow({ where: { seasonId, roundNumber, supersededAt: null } });
    const canReveal = reveal && round.status !== "BIDDING";
    const [submissions, teams, attempts, balances, players] = await Promise.all([
      this.prisma.auctionSubmission.findMany({ where: { roundId: round.id } }),
      this.prisma.seasonTeam.findMany({ where: { seasonId }, orderBy: { seedOrder: "asc" } }),
      this.prisma.auctionAttempt.findMany({ where: { roundId: round.id, supersededAt: null }, orderBy: { attemptNumber: "asc" } }),
      this.prisma.teamAuctionBalance.findMany({ where: { seasonId, roundNumber } }),
      canReveal ? this.prisma.player.findMany({ where: { seasonId }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const submissionMap = new Map(submissions.map(submission => [submission.seasonTeamId, submission]));
    const playerNames = new Map(players.map(player => [player.id, player.name]));
    return { roundId: round.id, roundNumber, status: round.status, revealed: canReveal, teams: teams.map(team => { const item = submissionMap.get(team.id)!; return { seasonTeamId: team.id, teamId: team.teamId, displayName: team.displayName, status: item.status as AuctionSubmissionStatus, bidCount: item.bidCount, ...(canReveal ? { bids: revealedBids(item.bidsJson, playerNames) } : {}) }; }), attempts: attempts.map(attempt => ({ attemptNumber: attempt.attemptNumber, status: attempt.status, inputHash: attempt.inputHash, outputHash: attempt.outputHash, unresolvedTies: (JSON.parse(attempt.outputJson) as AuctionEngineResult).unresolvedTies })), balances: balances.map(balance => ({ seasonTeamId: balance.seasonTeamId, startingBudget: balance.startingBudget, spent: balance.spent, remainingBudget: balance.remainingBudget })) };
  }
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
