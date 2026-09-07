import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { AuctionService } from "../../src/application/auction/auction-service.js";
import { SetupService } from "../../src/application/setup/setup-service.js";
import { openPostgresSeasonStore, type PrismaSeasonStore } from "../../src/infrastructure/postgres/season-store.js";
import { auctionEngineAdapter } from "../../src/integrations/auction-engine-adapter.js";
import { seasonTransactionAdapterContract } from "../contracts/season-transaction-contract.js";

const run = promisify(execFile);
const configuredConnectionString = process.env.COMMISSIONER_POSTGRES_TEST_URL;
if (!configuredConnectionString) throw new Error("COMMISSIONER_POSTGRES_TEST_URL is required for PostgreSQL persistence specs");
const connectionString: string = configuredConnectionString;

const actor = { subjectId: "account:commissioner", type: "OIDC_ACCOUNT", label: "Commissioner", effectiveRole: "COMMISSIONER", context: {} } as const;
const rosterRules = { positionLimits: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 }, flexEligiblePositions: ["RB", "WR", "TE"], flexCapacity: 1 };
const pools: pg.Pool[] = [];
const stores: PrismaSeasonStore[] = [];
let serial = 0;

function metadata(seasonId: string, commandType: string, extra: Record<string, unknown> = {}) {
  return { actor, seasonId, commandType, commandFingerprint: `${commandType}:${JSON.stringify(extra)}`, idempotencyKey: `${commandType}-${++serial}`, ...extra };
}

async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000 });
  pools.push(pool);
  return pool.query<T>(text, values);
}

async function open() {
  const store = await openPostgresSeasonStore(connectionString);
  stores.push(store);
  return store;
}

beforeAll(async () => {
  const url = new URL(connectionString);
  if (!url.pathname.endsWith("fantasy_draft_commissioner_phase3_test")) throw new Error("Refusing to reset a non-test PostgreSQL database");
  await query("DROP SCHEMA public CASCADE");
  await query("CREATE SCHEMA public AUTHORIZATION fdc_phase3_dev");
  await run(process.execPath, ["scripts/migrate-postgres.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, COMMISSIONER_POSTGRES_URL: connectionString },
  });
});

afterAll(async () => {
  await Promise.allSettled(stores.map(store => store.close()));
  await Promise.allSettled(pools.map(pool => pool.end()));
});

seasonTransactionAdapterContract("PostgreSQL", open);

describe("PostgreSQL hosted persistence", () => {
  it("contains every SQLite domain model while keeping hosted-only durability records isolated", async () => {
    const models = async (path: string) => new Set([...(await readFile(path, "utf8")).matchAll(/^model\s+(\w+)/gm)].map(match => match[1]));
    const sqlite = await models("prisma/schema.prisma");
    const postgres = await models("prisma/postgres/schema.prisma");
    expect([...sqlite].filter(model => !postgres.has(model))).toEqual([]);
    expect([...postgres].filter(model => !sqlite.has(model)).sort()).toEqual(["CommandReceipt", "OutboxEvent"]);
  });

  it("commits state, stable-principal audit, receipt, revision, and one redacted outbox event atomically", async () => {
    const store = await open();
    const seasonId = `atomic-${++serial}`;
    const command = metadata(seasonId, "CREATE_SEASON");
    const create = () => store.execute(command, tx => tx.createSeason({ id: seasonId, leagueId: `league-${seasonId}`, year: 2032, name: "Atomic", teamCount: 2 }));
    const first = await create();
    const replay = await create();

    expect(replay).toEqual(first);
    const rows = await query<{ audit: number; receipts: number; outbox: number }>(`SELECT
      (SELECT count(*)::int FROM "AuditEvent" WHERE "seasonId"=$1) audit,
      (SELECT count(*)::int FROM "CommandReceipt" WHERE "seasonId"=$1) receipts,
      (SELECT count(*)::int FROM "OutboxEvent" WHERE "seasonId"=$1) outbox`, [seasonId]);
    expect(rows.rows[0]).toEqual({ audit: 1, receipts: 1, outbox: 1 });
    const audit = await query<{ actorSubjectId: string; actorRole: string }>('SELECT "actorSubjectId", "actorRole" FROM "AuditEvent" WHERE "seasonId"=$1', [seasonId]);
    expect(audit.rows[0]).toEqual({ actorSubjectId: actor.subjectId, actorRole: actor.effectiveRole });
    const event = await query<Record<string, unknown>>('SELECT * FROM "OutboxEvent" WHERE "seasonId"=$1', [seasonId]);
    expect(Object.keys(event.rows[0] ?? {}).sort()).toEqual(["commandType", "correlationId", "createdAt", "cursor", "id", "projectionKind", "seasonId", "seasonRevision"].sort());
  });

  it("rejects reuse of an actor-scoped idempotency key with a different fingerprint", async () => {
    const store = await open();
    const seasonId = `fingerprint-${++serial}`;
    const base = { actor, seasonId, commandType: "CREATE_SEASON", idempotencyKey: "same-key" } as const;
    await store.execute({ ...base, commandFingerprint: "first" }, tx => tx.createSeason({ id: seasonId, leagueId: `league-${seasonId}`, year: 2033, name: "First", teamCount: 2 }));
    await expect(store.execute({ ...base, commandFingerprint: "different" }, () => { throw new Error("must not execute"); })).rejects.toThrow(/different command/i);
    const counts = await query<{ receipts: number; outbox: number }>('SELECT (SELECT count(*)::int FROM "CommandReceipt" WHERE "seasonId"=$1) receipts,(SELECT count(*)::int FROM "OutboxEvent" WHERE "seasonId"=$1) outbox', [seasonId]);
    expect(counts.rows[0]).toEqual({ receipts: 1, outbox: 1 });
  });

  it("rejects an unfingerprinted hosted command before it can write", async () => {
    const store = await open();
    const seasonId = `missing-fingerprint-${++serial}`;
    await expect(store.execute({ actor, seasonId, commandType: "CREATE_SEASON", idempotencyKey: "missing-fingerprint" }, tx => tx.createSeason({ id: seasonId, leagueId: `league-${seasonId}`, year: 2039, name: "Missing fingerprint", teamCount: 1 }))).rejects.toThrow(/require a command fingerprint/i);
    expect((await query<{ count: number }>('SELECT count(*)::int count FROM "Season" WHERE id=$1', [seasonId])).rows[0]?.count).toBe(0);
  });

  it("rolls state, audit, receipt, and outbox back as one unit", async () => {
    const store = await open();
    const seasonId = `rollback-${++serial}`;
    await expect(store.execute(metadata(seasonId, "CREATE_THEN_FAIL"), async tx => {
      await tx.createSeason({ id: seasonId, leagueId: `league-${seasonId}`, year: 2040, name: "Rollback", teamCount: 2 });
      throw new Error("forced rollback");
    })).rejects.toThrow("forced rollback");
    const rows = await query<{ seasons: number; audit: number; receipts: number; outbox: number }>(`SELECT
      (SELECT count(*)::int FROM "Season" WHERE id=$1) seasons,
      (SELECT count(*)::int FROM "AuditEvent" WHERE "seasonId"=$1) audit,
      (SELECT count(*)::int FROM "CommandReceipt" WHERE "seasonId"=$1) receipts,
      (SELECT count(*)::int FROM "OutboxEvent" WHERE "seasonId"=$1) outbox`, [seasonId]);
    expect(rows.rows[0]).toEqual({ seasons: 0, audit: 0, receipts: 0, outbox: 0 });
  });

  it("serializes simultaneous duplicate creates into one effect and one replay", async () => {
    const firstStore = await open();
    const secondStore = await open();
    const seasonId = `duplicate-race-${++serial}`;
    const command = metadata(seasonId, "CREATE_SEASON");
    const input = { id: seasonId, leagueId: `league-${seasonId}`, year: 2041, name: "Duplicate race", teamCount: 2 };
    const [first, second] = await Promise.all([
      firstStore.execute(command, tx => tx.createSeason(input)),
      secondStore.execute(command, tx => tx.createSeason(input)),
    ]);
    expect(second).toEqual(first);
    const rows = await query<{ audit: number; receipts: number; outbox: number }>('SELECT (SELECT count(*)::int FROM "AuditEvent" WHERE "seasonId"=$1) audit,(SELECT count(*)::int FROM "CommandReceipt" WHERE "seasonId"=$1) receipts,(SELECT count(*)::int FROM "OutboxEvent" WHERE "seasonId"=$1) outbox', [seasonId]);
    expect(rows.rows[0]).toEqual({ audit: 1, receipts: 1, outbox: 1 });
  });

  it("retries only PostgreSQL serialization/deadlock errors within the configured bound", async () => {
    const store = await openPostgresSeasonStore(connectionString, undefined, { maxTransactionAttempts: 3 });
    stores.push(store);
    const retry = (store as unknown as { retryPostgresTransaction<T>(work: () => Promise<T>): Promise<T> }).retryPostgresTransaction.bind(store);
    let executions = 0;
    await expect(retry(async () => {
      executions += 1;
      if (executions < 3) throw { code: "P2010", meta: { code: executions === 1 ? "40001" : "40P01" } };
      return "committed";
    })).resolves.toBe("committed");
    expect(executions).toBe(3);

    executions = 0;
    await expect(retry(async () => { executions += 1; throw new Error("Stale submission version"); })).rejects.toThrow(/stale submission/i);
    expect(executions).toBe(1);
  });

  it("makes committed outbox state visible before best-effort post-commit notification", async () => {
    const seasonId = `notify-${++serial}`;
    let observed = 0;
    const store = await openPostgresSeasonStore(connectionString, { committed: async () => { observed = (await query<{ count: number }>('SELECT count(*)::int count FROM "OutboxEvent" WHERE "seasonId"=$1', [seasonId])).rows[0]!.count; } });
    stores.push(store);
    await store.execute(metadata(seasonId, "CREATE_SEASON"), tx => tx.createSeason({ id: seasonId, leagueId: `league-${seasonId}`, year: 2034, name: "Notify", teamCount: 2 }));
    expect(observed).toBe(1);
  });

  it("allows independent-team saves while rejecting competing same-team versions", async () => {
    const store = await open();
    const setup = new SetupService(store, store);
    const seasonId = `concurrency-${++serial}`;
    await setup.createSeason(metadata(seasonId, "CREATE"), { seasonId, leagueId: `league-${seasonId}`, year: 2035, name: "Concurrent", teamCount: 2 });
    await setup.configureTeams(metadata(seasonId, "TEAMS"), [{ id: "alpha", displayName: "Alpha", seedOrder: 1 }, { id: "beta", displayName: "Beta", seedOrder: 2 }]);
    for (const [id, name] of [["p1", "One"], ["p2", "Two"]] as const) await setup.addCustomPlayer(metadata(seasonId, `PLAYER_${id}`), { id, name, position: "K", sourceType: "LEAGUE_CUSTOM" });
    await setup.setPriceFloors(metadata(seasonId, "FLOORS"), { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 });
    await setup.lockKeepers(metadata(seasonId, "LOCK_KEEPERS"), 14);
    const auction = new AuctionService(store, auctionEngineAdapter);
    const round = await auction.open(metadata(seasonId, "OPEN"), 1);
    const [alpha, beta] = round.teams;

    await expect(auction.submit(metadata(seasonId, "SAVE_WITHOUT_VERSION"), 1, alpha!.seasonTeamId, [{ playerId: "p1", amount: 10 }])).rejects.toThrow(/require an expected submission version/i);
    expect((await auction.submission(actor, seasonId, 1, alpha!.seasonTeamId)).submissionVersion).toBe(0);

    await Promise.all([
      auction.submit(metadata(seasonId, "SAVE_ALPHA", { expectedSubmissionVersion: 0 }), 1, alpha!.seasonTeamId, [{ playerId: "p1", amount: 10 }]),
      auction.submit(metadata(seasonId, "SAVE_BETA", { expectedSubmissionVersion: 0 }), 1, beta!.seasonTeamId, [{ playerId: "p2", amount: 10 }]),
    ]);
    expect((await auction.submission(actor, seasonId, 1, alpha!.seasonTeamId)).submissionVersion).toBe(1);
    expect((await auction.submission(actor, seasonId, 1, beta!.seasonTeamId)).submissionVersion).toBe(1);
    const orderedEvents = await query<{ cursor: string; seasonRevision: number }>('SELECT cursor::text,"seasonRevision" FROM "OutboxEvent" WHERE "seasonId"=$1 ORDER BY "OutboxEvent".cursor', [seasonId]);
    expect(orderedEvents.rows.map((event, index) => index === 0 || BigInt(event.cursor) > BigInt(orderedEvents.rows[index - 1]!.cursor)).every(Boolean)).toBe(true);
    expect(orderedEvents.rows.map(event => event.seasonRevision)).toEqual([...orderedEvents.rows.map(event => event.seasonRevision)].sort((left, right) => left - right));

    const competing = await Promise.allSettled([
      auction.submit(metadata(seasonId, "SAVE_ALPHA_A", { expectedSubmissionVersion: 1 }), 1, alpha!.seasonTeamId, [{ playerId: "p1", amount: 11 }]),
      auction.submit(metadata(seasonId, "SAVE_ALPHA_B", { expectedSubmissionVersion: 1 }), 1, alpha!.seasonTeamId, [{ playerId: "p1", amount: 12 }]),
    ]);
    expect(competing.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(competing.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(String((competing.find(result => result.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/stale submission version/i);
  });

  it("orders a round lock ahead of a waiting submission save without partial writes", async () => {
    const store = await open();
    const setup = new SetupService(store, store);
    const seasonId = `save-lock-${++serial}`;
    await setup.createSeason(metadata(seasonId, "CREATE"), { seasonId, leagueId: `league-${seasonId}`, year: 2037, name: "Save lock", teamCount: 1 });
    await setup.configureTeams(metadata(seasonId, "TEAMS"), [{ id: "alpha-lock", displayName: "Alpha", seedOrder: 1 }]);
    await setup.addCustomPlayer(metadata(seasonId, "PLAYER"), { id: `player-${seasonId}`, name: "Player", position: "K", sourceType: "LEAGUE_CUSTOM" });
    await setup.setPriceFloors(metadata(seasonId, "FLOORS"), { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 });
    await setup.lockKeepers(metadata(seasonId, "LOCK_KEEPERS"), 14);
    const auction = new AuctionService(store, auctionEngineAdapter);
    const round = await auction.open(metadata(seasonId, "OPEN"), 1);
    const teamId = round.teams[0]!.seasonTeamId;
    const before = await query<{ audit: number; receipts: number; outbox: number }>('SELECT (SELECT count(*)::int FROM "AuditEvent" WHERE "seasonId"=$1) audit,(SELECT count(*)::int FROM "CommandReceipt" WHERE "seasonId"=$1) receipts,(SELECT count(*)::int FROM "OutboxEvent" WHERE "seasonId"=$1) outbox', [seasonId]);

    const blocker = new pg.Client({ connectionString });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query('SELECT id FROM "Season" WHERE id=$1 FOR UPDATE', [seasonId]);
    const waitingSave = auction.submit(metadata(seasonId, "WAITING_SAVE", { expectedSubmissionVersion: 0 }), 1, teamId, [{ playerId: `player-${seasonId}`, amount: 10 }]);
    await new Promise(resolve => setTimeout(resolve, 50));
    await blocker.query('UPDATE "AuctionRound" SET status=$1 WHERE "seasonId"=$2 AND "roundNumber"=1', ["LOCKED", seasonId]);
    await blocker.query("COMMIT");
    await blocker.end();

    await expect(waitingSave).rejects.toThrow(/locked auction input/i);
    const submission = await auction.submission(actor, seasonId, 1, teamId);
    expect(submission).toMatchObject({ status: "DRAFT", bidCount: 0, submissionVersion: 0 });
    const after = await query<{ audit: number; receipts: number; outbox: number }>('SELECT (SELECT count(*)::int FROM "AuditEvent" WHERE "seasonId"=$1) audit,(SELECT count(*)::int FROM "CommandReceipt" WHERE "seasonId"=$1) receipts,(SELECT count(*)::int FROM "OutboxEvent" WHERE "seasonId"=$1) outbox', [seasonId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("runs the hosted commissioner auction lifecycle through atomic publish", async () => {
    const store = await open();
    const setup = new SetupService(store, store);
    const seasonId = `lifecycle-${++serial}`;
    await setup.createSeason(metadata(seasonId, "CREATE"), { seasonId, leagueId: `league-${seasonId}`, year: 2038, name: "Hosted lifecycle", teamCount: 2 });
    await setup.configureTeams(metadata(seasonId, "TEAMS"), [{ id: "hosted-a", displayName: "A", seedOrder: 1 }, { id: "hosted-b", displayName: "B", seedOrder: 2 }]);
    await setup.setPriceFloors(metadata(seasonId, "FLOORS"), { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 });
    await setup.lockKeepers(metadata(seasonId, "LOCK_KEEPERS"), 14);
    const auction = new AuctionService(store, auctionEngineAdapter);
    const round = await auction.open(metadata(seasonId, "OPEN"), 1);
    await Promise.all(round.teams.map(team => auction.submit(metadata(seasonId, `FINAL_${team.teamId}`, { expectedSubmissionVersion: 0 }), 1, team.seasonTeamId, [], { finalize: true, confirmZero: true })));
    await expect(auction.lockAndResolve(metadata(seasonId, "LOCK_RESOLVE"), 1, rosterRules)).resolves.toMatchObject({ status: "RESOLVED" });
    await auction.publish(metadata(seasonId, "PUBLISH"), 1);
    expect((await store.getSeason(actor, seasonId))?.state).toBe("R1_PUBLISHED");
    const counts = await query<{ mismatches: number }>(`SELECT count(*)::int mismatches FROM (
      SELECT a."commandType" FROM "AuditEvent" a LEFT JOIN "CommandReceipt" r ON r."auditEventId"=a.id LEFT JOIN "OutboxEvent" o ON o."correlationId"=a."correlationId"
      WHERE a."seasonId"=$1 AND (r.id IS NULL OR o.id IS NULL)
    ) missing`, [seasonId]);
    expect(counts.rows[0]?.mismatches).toBe(0);
  });

  it("keeps audit immutable and active-row uniqueness database-enforced", async () => {
    const store = await open();
    const seasonId = `constraints-${++serial}`;
    await store.execute(metadata(seasonId, "CREATE_SEASON"), tx => tx.createSeason({ id: seasonId, leagueId: `league-${seasonId}`, year: 2036, name: "Constraints", teamCount: 1 }));
    await expect(store.attemptAuditMutationForTesting()).rejects.toThrow(/append-only/i);
    const audit = await query<{ commandType: string }>('SELECT "commandType" FROM "AuditEvent" WHERE "seasonId"=$1', [seasonId]);
    expect(audit.rows[0]?.commandType).toBe("CREATE_SEASON");

    await query('INSERT INTO "PositionPriceFloor" (id,"seasonId",position,"minimumBid","supersededAt") VALUES ($1,$2,$3,$4,NULL)', [`floor-${seasonId}`, seasonId, "QB", 1]);
    await query('INSERT INTO "PositionPriceFloor" (id,"seasonId",position,"minimumBid","supersededAt") VALUES ($1,$2,$3,$4,now())', [`old-floor-${seasonId}`, seasonId, "QB", 2]);
    await expect(query('INSERT INTO "PositionPriceFloor" (id,"seasonId",position,"minimumBid","supersededAt") VALUES ($1,$2,$3,$4,NULL)', [`duplicate-floor-${seasonId}`, seasonId, "QB", 3])).rejects.toMatchObject({ code: "23505" });
  });

  it("replays void commands as undefined and does not let submission metadata bypass season staleness", async () => {
    const store = await open();
    const setup = new SetupService(store, store);
    const seasonId = `metadata-guards-${++serial}`;
    await setup.createSeason(metadata(seasonId, "CREATE"), { seasonId, leagueId: `league-${seasonId}`, year: 2042, name: "Metadata guards", teamCount: 1 });
    const teamsCommand = metadata(seasonId, "TEAMS");
    const teams = [{ id: `team-${seasonId}`, displayName: "Team", seedOrder: 1 }];
    await expect(setup.configureTeams(teamsCommand, teams)).resolves.toBeUndefined();
    await expect(setup.configureTeams(teamsCommand, teams)).resolves.toBeUndefined();
    const afterReplay = await query<{ count: number }>('SELECT count(*)::int count FROM "AuditEvent" WHERE "seasonId"=$1 AND "commandType"=$2', [seasonId, "TEAMS"]);
    expect(afterReplay.rows[0]?.count).toBe(1);

    const currentVersion = await store.seasonVersion(actor, seasonId);
    await expect(setup.setPriceFloors(metadata(seasonId, "STALE_FLOORS", { expectedVersion: currentVersion - 1, expectedSubmissionVersion: 0 }), { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 })).rejects.toThrow(/stale season version/i);
  });

  it("preserves deterministic ordering and PostgreSQL timestamp/boolean mappings", async () => {
    const store = await open();
    const upper = `Z-${++serial}`;
    const lower = `a-${++serial}`;
    await store.execute(metadata(upper, "CREATE_UPPER"), tx => tx.createSeason({ id: upper, leagueId: `league-${upper}`, year: 2099, name: "Upper", teamCount: 1 }));
    await store.execute(metadata(lower, "CREATE_LOWER"), tx => tx.createSeason({ id: lower, leagueId: `league-${lower}`, year: 2099, name: "Lower", teamCount: 1 }));
    const ordered = (await store.listSeasons(actor)).filter(season => season.year === 2099).map(season => season.id);
    expect(ordered).toEqual([upper, lower]);
    const mapped = await query<{ active: boolean; createdAt: Date }>('SELECT active,"createdAt" FROM "Season" WHERE id=$1', [upper]);
    expect(mapped.rows[0]?.active).toBe(false);
    expect(mapped.rows[0]?.createdAt).toBeInstanceOf(Date);
  });
});
