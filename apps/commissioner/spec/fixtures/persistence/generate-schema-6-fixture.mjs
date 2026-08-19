import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import Database from "better-sqlite3";
import { SetupService } from "../../../dist/src/application/setup/setup-service.js";
import { AuctionService } from "../../../dist/src/application/auction/auction-service.js";
import { DraftOrderService } from "../../../dist/src/application/draft-order/draft-order-service.js";
import { ConventionalDraftService } from "../../../dist/src/application/conventional-draft/conventional-draft-service.js";
import { CheckpointService } from "../../../dist/src/application/backups/checkpoint-service.js";
import { CorrectionService } from "../../../dist/src/application/corrections/correction-service.js";
import { CORRECTION_TYPES } from "../../../dist/src/application/corrections/correction-types.js";
import { resumeState } from "../../../dist/src/application/corrections/dependency-registry.js";
import { ExportService } from "../../../dist/src/application/exports/export-service.js";
import { BackupCoordinator } from "../../../dist/src/infrastructure/files/backup-coordinator.js";
import { auctionEngineAdapter } from "../../../dist/src/integrations/auction-engine-adapter.js";
import { openSeasonStore } from "../../../dist/src/infrastructure/sqlite/season-store.js";
import { CURRENT_SCHEMA_VERSION } from "../../../dist/src/infrastructure/sqlite/migrations.js";
import { LifecycleState } from "../../../dist/src/application/ports/season-repository.js";

const fixtureDirectory = fileURLToPath(new URL("./schema-6", import.meta.url));
const databasePath = join(fixtureDirectory, "released-schema-6.sqlite");
const backupDirectory = join(fixtureDirectory, "artifacts", "backups");
const exportDirectory = join(fixtureDirectory, "artifacts", "exports");
const baselineManifestPath = join(fixtureDirectory, "baseline-manifest.json");
const actor = { type: "LOCAL_COMMISSIONER", label: "Fixture Commissioner" };
const completedSeasonId = "season-schema-6-completed";
const cleanSeasonId = "season-schema-6-clean";
const sha256 = value => createHash("sha256").update(value).digest("hex");
const quote = identifier => `"${identifier.replaceAll('"', '""')}"`;

const rosterRules = {
  limits: { QB: 2, RB: 3, WR: 3, TE: 2, K: 2, DST: 2 },
  flexEligible: ["RB", "WR", "TE"],
  flexCapacity: 1,
};
const auctionRules = {
  positionLimits: rosterRules.limits,
  flexEligiblePositions: rosterRules.flexEligible,
  flexCapacity: rosterRules.flexCapacity,
};

await mkdir(fixtureDirectory, { recursive: false });
await mkdir(backupDirectory, { recursive: true });
await mkdir(exportDirectory, { recursive: true });

const store = await openSeasonStore(databasePath);
const checkpoints = new CheckpointService(databasePath, backupDirectory);
const setup = new SetupService(store, store, checkpoints);
const auction = new AuctionService(store, auctionEngineAdapter, checkpoints);
const order = new DraftOrderService(store, checkpoints);
const draft = new ConventionalDraftService(store, checkpoints);
let serial = 0;
const command = async (seasonId, commandType) => ({
  actor,
  seasonId,
  commandType,
  idempotencyKey: `fixture-${String(++serial).padStart(3, "0")}-${commandType.toLowerCase()}`,
  ...((await store.getSeason(actor, seasonId))
    ? { expectedVersion: await store.seasonVersion(seasonId) }
    : {}),
});

await setup.createSeason(await command(cleanSeasonId, "CREATE_SEASON"), {
  seasonId: cleanSeasonId,
  leagueId: "league-schema-6-clean",
  year: 2027,
  name: "Clean schema-6 season",
  teamCount: 1,
});

await setup.createSeason(await command(completedSeasonId, "CREATE_SEASON"), {
  seasonId: completedSeasonId,
  leagueId: "league-schema-6-completed",
  year: 2026,
  name: "Released schema-6 season",
  teamCount: 2,
});
await setup.configureTeams(await command(completedSeasonId, "CONFIGURE_TEAMS"), [
  { id: "team-alpha", displayName: "Alpha", seedOrder: 1 },
  { id: "team-beta", displayName: "Beta", seedOrder: 2 },
]);
await setup.addCustomPlayer(await command(completedSeasonId, "ADD_CUSTOM_PLAYER"), {
  id: "custom-beta-keeper",
  name: "Custom Beta Keeper",
  position: "K",
  sourceType: "LEAGUE_CUSTOM",
  explicitMinimumBid: 4,
});

const alphaRoster = [
  ["A-QB-1", "QB"], ["A-QB-2", "QB"],
  ["A-RB-1", "RB"], ["A-RB-2", "RB"], ["A-RB-3", "RB"],
  ["A-WR-1", "WR"], ["A-WR-2", "WR"], ["A-WR-3", "WR"],
  ["A-TE-1", "TE"], ["A-TE-2", "TE"],
  ["A-K-1", "K"], ["A-K-2", "K"],
  ["A-DST-1", "DST"], ["A-DST-2", "DST"],
];
const betaImportedRoster = [
  ["B-QB-1", "QB"], ["B-QB-2", "QB"],
  ["B-RB-1", "RB"], ["B-RB-2", "RB"], ["B-RB-3", "RB"],
  ["B-WR-1", "WR"], ["B-WR-2", "WR"], ["B-WR-3", "WR"],
  ["B-TE-1", "TE"], ["B-TE-2", "TE"],
  ["B-K-2", "K"],
  ["B-DST-1", "DST"], ["B-DST-2", "DST"],
];
const surplusPlayers = [["FREE-RB", "RB"], ["FREE-WR", "WR"], ["FREE-DST", "DST"]];
const importedRows = [...alphaRoster, ...betaImportedRoster, ...surplusPlayers].map(([name, position], index) => ({
  externalId: `nfl-${String(index + 1).padStart(3, "0")}`,
  name,
  position,
  ...(index === 0 ? { minimumBid: 6 } : {}),
}));
const importContent = JSON.stringify(importedRows);
const importPreview = await setup.previewImport(await command(completedSeasonId, "PREVIEW_IMPORT"), "nfl-2026", importContent, "json");
if (importPreview.errors.length || importPreview.reviews.length) throw new Error(`Unexpected import review: ${JSON.stringify(importPreview)}`);
await setup.commitImport(await command(completedSeasonId, "COMMIT_IMPORT"), "nfl-2026", "json", importPreview);
await setup.setPriceFloors(await command(completedSeasonId, "SET_PRICE_FLOORS"), { QB: 3, RB: 2, WR: 2, TE: 2, K: 1, DST: 1 });
const setupSummary = await setup.summary({ actor, seasonId: completedSeasonId });
const alpha = setupSummary.teams.find(team => team.id === "team-alpha");
const beta = setupSummary.teams.find(team => team.id === "team-beta");
if (!alpha || !beta) throw new Error("Fixture teams were not created");
await setup.setKeeperEligibility(await command(completedSeasonId, "SET_KEEPER_ELIGIBILITY"), ["custom-beta-keeper"]);
await setup.selectKeeper(await command(completedSeasonId, "SELECT_KEEPER"), beta.seasonTeamId, "custom-beta-keeper");
await setup.lockKeepers(await command(completedSeasonId, "LOCK_KEEPERS"), 14);

const playerIdByName = new Map((await setup.summary({ actor, seasonId: completedSeasonId })).players.map(player => [player.name, player.id]));
const playerId = name => {
  const id = playerIdByName.get(name);
  if (!id) throw new Error(`Fixture player not found: ${name}`);
  return id;
};

await auction.open(await command(completedSeasonId, "OPEN_AUCTION_R1"), 1);
await auction.submit(await command(completedSeasonId, "SUBMIT_ALPHA_R1"), 1, alpha.seasonTeamId, [{ playerId: playerId("A-QB-1"), amount: 60 }], { finalize: true });
await auction.submit(await command(completedSeasonId, "SUBMIT_BETA_R1"), 1, beta.seasonTeamId, [{ playerId: playerId("B-QB-1"), amount: 10 }], { finalize: true });
await auction.lockAndResolve(await command(completedSeasonId, "LOCK_AUCTION_R1"), 1, auctionRules);
await auction.publish(await command(completedSeasonId, "PUBLISH_AUCTION_R1"), 1);

await auction.open(await command(completedSeasonId, "OPEN_AUCTION_R2"), 2);
await auction.submit(await command(completedSeasonId, "SUBMIT_ALPHA_R2_ZERO"), 2, alpha.seasonTeamId, [], { finalize: true, confirmZero: true });
await auction.submit(await command(completedSeasonId, "SUBMIT_BETA_R2_ZERO"), 2, beta.seasonTeamId, [], { finalize: true, confirmZero: true });
await auction.lockAndResolve(await command(completedSeasonId, "LOCK_AUCTION_R2"), 2, auctionRules);
await auction.publish(await command(completedSeasonId, "PUBLISH_AUCTION_R2"), 2);

const pausedOrder = await order.calculate(await command(completedSeasonId, "CALCULATE_DRAFT_ORDER"));
if (pausedOrder.status !== "TIE_PAUSED" || pausedOrder.ties.length !== 1) throw new Error(`Expected one tied draft-order group: ${JSON.stringify(pausedOrder)}`);
await order.decide(await command(completedSeasonId, "DECIDE_DRAFT_ORDER_TIE"), {
  balance: pausedOrder.ties[0].balance,
  participantTeamIds: pausedOrder.ties[0].seasonTeamIds,
  precedenceTeamIds: [alpha.seasonTeamId, beta.seasonTeamId],
  method: "fixture coin toss",
  note: "Alpha called heads",
  decidedAt: "2026-08-17T20:00:00.000Z",
});
await order.finalize(await command(completedSeasonId, "FINALIZE_DRAFT_ORDER"));

const remainingByTeam = new Map([
  [alpha.seasonTeamId, alphaRoster.filter(([name]) => name !== "A-QB-1").map(([name]) => playerId(name))],
  [beta.seasonTeamId, betaImportedRoster.filter(([name]) => name !== "B-QB-1").map(([name]) => playerId(name))],
]);
let draftSummary = await draft.summary({ actor, seasonId: completedSeasonId });
while (draftSummary.status !== "COMPLETED") {
  const currentTeamId = draftSummary.currentSeasonTeamId;
  if (!currentTeamId) throw new Error(`No team on the clock: ${JSON.stringify(draftSummary)}`);
  const nextPlayerId = remainingByTeam.get(currentTeamId)?.shift();
  if (!nextPlayerId) throw new Error(`No legal fixture player queued for ${currentTeamId}`);
  draftSummary = await draft.pick(await command(completedSeasonId, "MAKE_DRAFT_PICK"), {
    seasonTeamId: currentTeamId,
    playerId: nextPlayerId,
    rosterRules,
  });
}
if ([...remainingByTeam.values()].some(players => players.length)) throw new Error("Fixture draft completed before consuming its planned roster");

const exported = await new ExportService(databasePath, backupDirectory).export(
  completedSeasonId,
  exportDirectory,
  rosterRules,
  await command(completedSeasonId, "EXPORT_COMPLETED_SEASON"),
);

const fixtureDb = new Database(databasePath, { readonly: true, fileMustExist: true });
const finalPick = fixtureDb.prepare(`SELECT dp.id FROM DraftPick dp JOIN ConventionalDraft d ON d.id=dp.conventionalDraftId WHERE d.seasonId=? AND dp.active=1 ORDER BY dp.overallPick DESC LIMIT 1`).pluck().get(completedSeasonId);
fixtureDb.close();
await new CorrectionService(databasePath, backupDirectory).preview(
  completedSeasonId,
  "PICK",
  String(finalPick),
  await command(completedSeasonId, "PREVIEW_PICK_CORRECTION"),
);
await store.close();

const releasedBackup = await new BackupCoordinator(databasePath).create(fixtureDirectory, {
  seasonId: completedSeasonId,
  trigger: "RELEASED_SCHEMA_6_FIXTURE",
});

const db = new Database(databasePath, { readonly: true, fileMustExist: true });
const tableNames = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).pluck().all();
const tables = tableNames.map(name => {
  const columns = db.pragma(`table_info(${quote(name)})`).map(column => ({
    cid: column.cid,
    name: column.name,
    type: column.type,
    notNull: Boolean(column.notnull),
    defaultValue: column.dflt_value,
    primaryKeyOrdinal: column.pk,
  }));
  const primaryKey = columns.filter(column => column.primaryKeyOrdinal > 0).sort((a, b) => a.primaryKeyOrdinal - b.primaryKeyOrdinal).map(column => column.name);
  const orderColumns = primaryKey.length ? primaryKey : columns.map(column => column.name);
  const projection = columns.map(column => quote(column.name)).join(",");
  const ordering = orderColumns.map(column => quote(column)).join(",");
  const rows = db.prepare(`SELECT ${projection} FROM ${quote(name)} ORDER BY ${ordering}`).all();
  const foreignKeys = db.pragma(`foreign_key_list(${quote(name)})`).map(key => ({
    id: key.id,
    sequence: key.seq,
    table: key.table,
    from: key.from,
    to: key.to,
    onUpdate: key.on_update,
    onDelete: key.on_delete,
    match: key.match,
  })).sort((a, b) => a.id - b.id || a.sequence - b.sequence);
  return {
    name,
    columns,
    foreignKeys,
    rowCount: rows.length,
    orderBy: orderColumns,
    relationalSha256: sha256(JSON.stringify(rows)),
  };
});
const relativeFixturePath = path => relative(fixtureDirectory, path).replaceAll("\\", "/");
const frozenSnapshots = db.prepare(`SELECT id,kind,payloadJson,sha256 FROM FrozenSnapshot ORDER BY id`).all().map(row => ({
  id: row.id,
  kind: row.kind,
  sha256: row.sha256,
  payloadSha256: sha256(row.payloadJson),
}));
const auctionAttempts = db.prepare(`SELECT id,roundId,attemptNumber,inputJson,inputHash,outputJson,outputHash FROM AuctionAttempt ORDER BY roundId,attemptNumber`).all().map(row => ({
  id: row.id,
  roundId: row.roundId,
  attemptNumber: row.attemptNumber,
  inputHash: row.inputHash,
  inputJsonSha256: sha256(row.inputJson),
  outputHash: row.outputHash,
  outputJsonSha256: sha256(row.outputJson),
}));
const exportedJson = await readFile(exported.jsonPath);
const exportedCsv = await readFile(exported.csvPath);
const seasons = db.prepare(`SELECT id,state,rowVersion FROM Season ORDER BY id`).all();
const semanticCounts = Object.fromEntries([
  ["customPlayers", `SELECT count(*) FROM Player WHERE custom=1`],
  ["importedPlayers", `SELECT count(*) FROM Player WHERE custom=0`],
  ["availablePlayers", `SELECT count(*) FROM Player WHERE available=1`],
  ["unavailablePlayers", `SELECT count(*) FROM Player WHERE available=0`],
  ["ownedPlayers", `SELECT count(DISTINCT playerId) FROM RosterAssignment WHERE supersededAt IS NULL`],
  ["unownedPlayers", `SELECT count(*) FROM Player p WHERE NOT EXISTS (SELECT 1 FROM RosterAssignment r WHERE r.playerId=p.id AND r.supersededAt IS NULL)`],
  ["auctionRounds", `SELECT count(*) FROM AuctionRound`],
  ["draftOrderEntries", `SELECT count(*) FROM DraftOrderEntry`],
  ["draftPicks", `SELECT count(*) FROM DraftPick`],
  ["auditEvents", `SELECT count(*) FROM AuditEvent`],
  ["checkpoints", `SELECT count(*) FROM Checkpoint`],
  ["backupRecords", `SELECT count(*) FROM BackupRecord`],
  ["correctionActions", `SELECT count(*) FROM CorrectionAction`],
  ["exports", `SELECT count(*) FROM ExportRecord`],
].map(([key, sql]) => [key, Number(db.prepare(sql).pluck().get())]));
const manifest = {
  format: "commissioner-schema-6-baseline/v1",
  provenance: {
    commit: "23c994c",
    tag: "phase2-baseline",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    generatedThrough: "accepted Commissioner application services and migrations",
  },
  databaseFile: relativeFixturePath(databasePath),
  databaseSha256: sha256(await readFile(databasePath)),
  wholeDatabaseHashPolicy: "informational-only; additive migrations are expected to change SQLite file bytes",
  releasedBackup: {
    databaseFile: relativeFixturePath(releasedBackup.path),
    manifestFile: relativeFixturePath(releasedBackup.manifestPath),
    sha256: releasedBackup.sha256,
  },
  integrity: db.pragma("integrity_check", { simple: true }),
  foreignKeyViolations: db.pragma("foreign_key_check"),
  seasons,
  lifecycleResumes: Object.values(LifecycleState),
  correctionResumeDefaults: Object.fromEntries(CORRECTION_TYPES.map(type => [type, resumeState(type)])),
  defaultClasses: tables.flatMap(table => table.columns.filter(column => column.defaultValue !== null).map(column => ({ table: table.name, column: column.name, defaultValue: column.defaultValue }))),
  tables,
  immutableHashes: {
    frozenSnapshots,
    auctionAttempts,
    conventionalDraft: db.prepare(`SELECT id,orderSnapshotId,orderHash FROM ConventionalDraft ORDER BY id`).all(),
    backupRecords: db.prepare(`SELECT id,trigger,sha256,schemaVersion,seasonVersion,dependencyCutHash FROM BackupRecord ORDER BY id`).all(),
    exportRecords: db.prepare(`SELECT id,jsonSha256,csvSha256,schemaVersion FROM ExportRecord ORDER BY id`).all(),
    exportedFiles: {
      json: { file: relativeFixturePath(exported.jsonPath), sha256: sha256(exportedJson) },
      csv: { file: relativeFixturePath(exported.csvPath), sha256: sha256(exportedCsv) },
    },
  },
  semanticCounts,
};
db.close();
await writeFile(baselineManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ databasePath, baselineManifestPath, releasedBackup: manifest.releasedBackup, semanticCounts }, null, 2));
