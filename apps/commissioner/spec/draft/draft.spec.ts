import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { openSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";
import { LifecycleState, type CommandMetadata } from "../../src/application/ports/season-repository.js";
import { canAddPlayerThroughPhase1 } from "../../src/integrations/roster-validator-adapter.js";
import { SqliteCorrectionAdapter } from "../../src/infrastructure/operations/sqlite-correction-adapter.js";
import { CorrectionService } from "../../src/application/corrections/correction-service.js";
import { BootstrapService } from "../../src/application/bootstrap/bootstrap-service.js";

const actor = { subjectId: "local:commissioner", type: "LOCAL_COMMISSIONER", label: "Commissioner", effectiveRole: "COMMISSIONER", context: {} };
const rules = { limits: { QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 }, flexEligible: ["RB", "WR", "TE"], flexCapacity: 1 };
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const command = (seasonId: string, commandType: string, idempotencyKey = commandType): CommandMetadata => ({ actor, seasonId, commandType, idempotencyKey });

async function seeded(teamBalances: number[], playersPerTeam = 14) {
  const dir = await mkdtemp(join(tmpdir(), "u5-draft-")); dirs.push(dir); const path = join(dir, "db.sqlite"); const seasonId = `s-${Date.now()}-${Math.random()}`;
  let store = await openSeasonStore(path); await store.execute(command(seasonId, "CREATE"), tx => tx.createSeason({ id: seasonId, leagueId: `l-${seasonId}`, year: 2026, name: "U5", teamCount: teamBalances.length }));
  await store.configureTeams(command(seasonId, "TEAMS"), teamBalances.map((_, i) => ({ id: `team-${i}`, displayName: String.fromCharCode(65 + i), seedOrder: i + 1 })));
  const summary = await store.setupSummary(actor, seasonId); const positions = ["QB", "QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "K", "K", "DST", "DST"] as const;
  for (let i = 0; i < teamBalances.length * playersPerTeam; i++) await store.addCustomPlayer(command(seasonId, `PLAYER-${i}`), { id: `p-${i}`, name: `Player ${i}`, position: positions[i % positions.length]!, sourceType: "LEAGUE_CUSTOM" });
  await store.close(); const db = new Database(path); db.prepare("UPDATE Season SET state='R2_PUBLISHED' WHERE id=?").run(seasonId); for (const [i, balance] of teamBalances.entries()) db.prepare("INSERT INTO TeamAuctionBalance(id,seasonId,seasonTeamId,roundNumber,startingBudget,spent,remainingBudget) VALUES(?,?,?,?,?,?,?)").run(`b-${i}`, seasonId, summary.teams[i]!.seasonTeamId, 2, balance, 0, balance); db.close(); store = await openSeasonStore(path); return { store, seasonId, teams: summary.teams, positions };
}

describe("permanent draft order", () => {
  it("retains corrected order and pick history while accepting fresh precedence and replacement picks after restart", async () => {
    const { store, seasonId } = await seeded([100, 100]);
    const paused = await store.calculate(command(seasonId, "HISTORY-CALC"));
    const tie = paused.ties[0]!;
    await store.recordDraftOrderTieDecision(command(seasonId, "HISTORY-TIE"), { balance: 100, participantTeamIds: tie.seasonTeamIds, precedenceTeamIds: tie.seasonTeamIds, method: "original draw", decidedAt: new Date().toISOString() });
    const original = await store.finalize(command(seasonId, "HISTORY-FINAL"));
    await store.makePick(command(seasonId, "HISTORY-PICK"), { seasonTeamId: original.order[0]!.seasonTeamId, playerId: "p-0", rosterRules: rules });
    await store.close();
    const dir = dirs[dirs.length - 1]!;
    const path = join(dir, "db.sqlite");
    const readHistory = () => {
      const db = new Database(path);
      try { return Object.fromEntries(["DraftOrderEntry", "DraftOrderTieDecision", "DraftPick"].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()])); }
      finally { db.close(); }
    };
    const originalRows = readHistory();
    const versionDatabase = new Database(path, { readonly: true });
    const version = versionDatabase.prepare("SELECT rowVersion FROM Season WHERE id=?").get(seasonId) as { rowVersion: number };
    versionDatabase.close();
    const corrections = new CorrectionService(new SqliteCorrectionAdapter(path, join(dir, "backups")));
    const preview = await corrections.preview({ ...command(seasonId, "PREVIEW_CORRECTION"), expectedVersion: version.rowVersion }, "DRAFT_ORDER");
    await corrections.confirm({ ...command(seasonId, "CONFIRM_CORRECTION"), expectedVersion: preview.seasonVersion }, preview.id, { cutHash: preview.cutHash, backupHash: preview.backupHash, confirmation: "CONFIRM ROLLBACK", reason: "Replace incorrect external precedence" });
    const historicalRows = readHistory();
    for (const [table, rows] of Object.entries(historicalRows)) {
      expect(rows).toHaveLength(originalRows[table]!.length);
      for (const row of rows as Array<Record<string, unknown>>) expect(row.supersededAt).toBeTruthy();
    }
    let resumed = await openSeasonStore(path);
    try {
      const recalculated = await resumed.calculate(command(seasonId, "REPLACEMENT-CALC"));
      expect(recalculated.order).toEqual([]);
      expect(recalculated.ties).toEqual(paused.ties);
      expect((await new BootstrapService(resumed).load(actor, seasonId)).phases.draft?.order).toEqual([]);
      const replacement = [...tie.seasonTeamIds].reverse();
      await resumed.recordDraftOrderTieDecision(command(seasonId, "REPLACEMENT-TIE"), { balance: 100, participantTeamIds: tie.seasonTeamIds, precedenceTeamIds: replacement, method: "corrected draw", decidedAt: new Date().toISOString() });
      const audit = await resumed.auditForSeason(actor, seasonId);
      await expect(resumed.recordDraftOrderTieDecision(command(seasonId, "DUPLICATE-TIE"), { balance: 100, participantTeamIds: tie.seasonTeamIds, precedenceTeamIds: replacement, method: "duplicate", decidedAt: new Date().toISOString() })).rejects.toThrow();
      expect(await resumed.auditForSeason(actor, seasonId)).toEqual(audit);
      const final = await resumed.finalize(command(seasonId, "REPLACEMENT-FINAL"));
      expect(final.order.map(team => team.seasonTeamId)).toEqual(replacement);
      await resumed.close();
      resumed = await openSeasonStore(path);
      const pick = await resumed.makePick(command(seasonId, "REPLACEMENT-PICK"), { seasonTeamId: replacement[0]!, playerId: "p-0", rosterRules: rules });
      expect(pick.history).toHaveLength(1);
      expect(pick.nextOverallPick).toBe(2);
      expect(pick.currentSeasonTeamId).toBe(replacement[1]);
      expect((await new BootstrapService(resumed).load(actor, seasonId)).phases.draft?.order).toEqual(pick.order);
    } finally { await resumed.close(); }
    const allRows = readHistory();
    for (const [table, rows] of Object.entries(historicalRows)) {
      expect(allRows[table]).toHaveLength(rows.length * 2);
      expect(allRows[table]).toEqual(expect.arrayContaining(rows));
    }
    const db = new Database(path);
    try {
      for (const table of ["DraftOrderEntry", "DraftOrderTieDecision", "DraftPick"]) {
        const row = db.prepare(`SELECT * FROM ${table} WHERE supersededAt IS NULL LIMIT 1`).get() as Record<string, unknown>;
        const columns = Object.keys(row);
        expect(() => db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map(column => column === "id" ? `duplicate-${table}` : row[column]))).toThrow(/UNIQUE constraint failed/);
      }
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });
  it("ranks unique committed balances descending and freezes the order", async () => { const { store, seasonId, teams } = await seeded([100, 120, 80]); const result = await store.calculate(command(seasonId, "CALC")); expect(result.status).toBe("FINAL"); expect(result.order.map(item => item.seasonTeamId)).toEqual([teams[1]!.seasonTeamId, teams[0]!.seasonTeamId, teams[2]!.seasonTeamId]); await store.close(); });
  it("requires valid external precedence for every independent two/multi-team tie", async () => { const { store, seasonId } = await seeded([100, 100, 90, 90, 90]); const paused = await store.calculate(command(seasonId, "CALC")); expect(paused.ties.map(item => item.seasonTeamIds.length).sort()).toEqual([2, 3]); await expect(store.finalize(command(seasonId, "EARLY"))).rejects.toThrow("Missing external precedence"); const first = paused.ties.find(t => t.balance === 100)!; await expect(store.recordDraftOrderTieDecision(command(seasonId, "BAD"), { balance: 100, participantTeamIds: first.seasonTeamIds, precedenceTeamIds: [first.seasonTeamIds[0]!, first.seasonTeamIds[0]!], method: "draw", decidedAt: new Date().toISOString() })).rejects.toThrow("exactly once"); for (const tie of paused.ties) await store.recordDraftOrderTieDecision(command(seasonId, `TIE-${tie.balance}`), { balance: tie.balance, participantTeamIds: tie.seasonTeamIds, precedenceTeamIds: [...tie.seasonTeamIds].reverse(), method: "external draw", decidedAt: new Date().toISOString() }); const final = await store.finalize(command(seasonId, "FINAL")); const expected = [...paused.ties.find(t => t.balance === 100)!.seasonTeamIds].reverse().concat([...paused.ties.find(t => t.balance === 90)!.seasonTeamIds].reverse()); expect(final.order.map(item => item.seasonTeamId)).toEqual(expected); await store.close(); });
});

describe("fixed-order conventional drafting", () => {
  it("reads only season-scoped active roster/history player IDs for draft summaries", async () => {
    const { store, seasonId } = await seeded([120], 28);
    const order = await store.calculate(command(seasonId, "BOUNDED-ORDER"));
    await store.makePick(command(seasonId, "BOUNDED-PICK"), { seasonTeamId: order.order[0]!.seasonTeamId, playerId: "p-0", rosterRules: rules });
    const prisma = (store as unknown as { prisma: PrismaClient }).prisma;
    const originalRead = prisma.player.findMany.bind(prisma.player);
    const read = vi.spyOn(prisma.player, "findMany").mockImplementation(originalRead);
    try {
      const summary = await store.draftSummary(actor, seasonId);
      expect(summary.history.map(pick => pick.playerId)).toEqual(["p-0"]);
      expect(read).toHaveBeenCalledExactlyOnceWith({ where: { seasonId, id: { in: ["p-0"] } } });
    } finally { read.mockRestore(); await store.close(); }
  });
  it("rehydrates pick three's clock and roster after correcting a five-pick draft",async()=>{
    const {store,seasonId}=await seeded([120,110]); const order=await store.calculate(command(seasonId,"REWIND-ORDER"));
    for(let index=0;index<5;index++)await store.makePick(command(seasonId,`REWIND-${index}`),{seasonTeamId:order.order[index%2]!.seasonTeamId,playerId:`p-${index}`,rosterRules:rules});
    await store.close(); const dir=dirs[dirs.length-1]!; const path=join(dir,"db.sqlite"); const db=new Database(path); const pick=db.prepare("SELECT id FROM DraftPick WHERE overallPick=3 AND active=1").get() as {id:string}; const version=db.prepare("SELECT rowVersion FROM Season WHERE id=?").get(seasonId) as {rowVersion:number}; db.close();
    const corrections=new CorrectionService(new SqliteCorrectionAdapter(path,join(dir,"backups"))); const preview=await corrections.preview({...command(seasonId,"PREVIEW_CORRECTION"),expectedVersion:version.rowVersion},"PICK",pick.id);
    await corrections.confirm({...command(seasonId,"CONFIRM_CORRECTION"),expectedVersion:preview.seasonVersion},preview.id,{cutHash:preview.cutHash,backupHash:preview.backupHash,confirmation:"CONFIRM ROLLBACK",reason:"Wrong player at pick three"});
    const resumed=await openSeasonStore(path); const bootstrap=await new BootstrapService(resumed).load(actor,seasonId);
    expect(bootstrap.legalStage).toBe("DRAFT"); expect(bootstrap.phases.draft?.nextOverallPick).toBe(3); expect(bootstrap.phases.draft?.currentSeasonTeamId).toBe(order.order[0]!.seasonTeamId);
    expect(bootstrap.phases.draft?.history.map(item=>item.overallPick)).toEqual([2,1]); expect(bootstrap.phases.draft?.teams.flatMap(team=>team.roster).map(player=>player.playerId).sort()).toEqual(["p-0","p-1"]);
    await resumed.close();
  });
  it("includes canonical keeper and auction acquisitions in roster needs",async()=>{
    const {store,seasonId,teams}=await seeded([120]); await store.close(); const path=join(dirs[dirs.length-1]!,"db.sqlite"); const db=new Database(path);
    for(const [id,source] of [["p-0","KEEPER"],["p-1","AUCTION"]]) {db.prepare("INSERT INTO RosterAssignment(id,seasonId,seasonTeamId,playerId,acquisitionSource,sourceEntityId) VALUES(?,?,?,?,?,?)").run(`assignment-${id}`,seasonId,teams[0]!.seasonTeamId,id,source,`source-${id}`);db.prepare("UPDATE Player SET available=0 WHERE id=?").run(id);}
    db.close(); const resumed=await openSeasonStore(path); const summary=await resumed.calculate(command(seasonId,"ACQUISITIONS"));
    expect(summary.teams[0]!.roster.map(player=>player.acquisitionSource).sort()).toEqual(["AUCTION","KEEPER"]); expect(summary.teams[0]!.positionCounts.QB).toBe(2); expect(summary.teams[0]!.openSlots).toBe(12); expect(summary.teams[0]!.legalNextPositions).not.toContain("QB"); await resumed.close();
  });
  it("rejects excess K, stale version, owned and legacy unknown-position picks without changing canonical state or audit", async () => {
    const seededDraft=await seeded([120],28); let store=seededDraft.store; const {seasonId}=seededDraft;
    const order=await store.calculate(command(seasonId,"REJECTION-ORDER")); const team=order.order[0]!.seasonTeamId;
    for(const playerId of ["p-10","p-11"])await store.makePick(command(seasonId,`K-${playerId}`),{seasonTeamId:team,playerId,rosterRules:rules});
    const before=await store.draftSummary(actor,seasonId); const audit=await store.auditForSeason(actor,seasonId); const season=await store.getSeason(actor,seasonId);
    for(const [key,playerId,reason,expectedVersion] of [["K-OVER","p-24","ROSTER_CAPACITY_EXCEEDED",undefined],["OWNED","p-10","unavailable",undefined],["STALE","p-0","Stale season version",0]] as const){
      await expect(store.makePick({...command(seasonId,key),...(expectedVersion===undefined?{}:{expectedVersion})},{seasonTeamId:team,playerId,rosterRules:rules})).rejects.toThrow(reason);
      expect(await store.draftSummary(actor,seasonId)).toEqual(before); expect(await store.auditForSeason(actor,seasonId)).toEqual(audit); expect(await store.getSeason(actor,seasonId)).toEqual(season);
    }
    await store.close();
    const path=join(dirs[dirs.length-1]!,"db.sqlite"); const db=new Database(path); db.prepare("UPDATE Player SET position='UNKNOWN' WHERE id='p-0'").run(); db.close(); store=await openSeasonStore(path);
    await expect(store.makePick(command(seasonId,"UNKNOWN"),{seasonTeamId:team,playerId:"p-0",rosterRules:rules})).rejects.toThrow("UNKNOWN_POSITION");
    expect(await store.draftSummary(actor,seasonId)).toEqual(before); expect(await store.auditForSeason(actor,seasonId)).toEqual(audit); await store.close();
  });
  it("matches Phase 1 legal-next guidance for empty, partial, FLEX-filled and nearly complete rosters and survives restart", async () => {
    const { store, seasonId } = await seeded([120]);
    let summary = await store.calculate(command(seasonId, "GUIDANCE"));
    const id = summary.order[0]!.seasonTeamId;
    const positions = ["QB","QB","RB","RB","RB","WR","WR","WR","TE","TE","K","K","DST","DST"];
    for (let count=0;count<14;count++) {
      const team=summary.teams.find(item=>item.seasonTeamId===id)!;
      expect(team.openSlots).toBe(14-count);
      expect(team.legalNextPositions).toEqual(["QB","RB","WR","TE","K","DST"].filter(position=>canAddPlayerThroughPhase1(positions.slice(0,count),position,rules).legal));
      summary=await store.makePick(command(seasonId,`GUIDE-${count}`),{seasonTeamId:id,playerId:`p-${count}`,rosterRules:rules});
    }
    expect(summary.status).toBe("COMPLETED");
    expect(summary.teams[0]!.openSlots).toBe(0);
    await store.close();
    const reopened=await openSeasonStore(join(dirs[dirs.length-1]!,"db.sqlite"));
    expect(await reopened.draftSummary(actor,seasonId)).toEqual(summary);
    await reopened.close();
  });
  it("returns clock, canonical rosters, informative needs, and reverse pick history", async () => {
    const { store, seasonId } = await seeded([120, 110]);
    const order = await store.calculate(command(seasonId, "CALC-CONTROL"));
    const alpha = order.order[0]!.seasonTeamId;
    const beta = order.order[1]!.seasonTeamId;
    const first = await store.makePick(command(seasonId, "CONTROL-P1"), { seasonTeamId: alpha, playerId: "p-0", rosterRules: rules });
    expect(first.currentSeasonTeamId).toBe(beta);
    expect(first.currentRound).toBe(1);
    expect(first.filledRosterSlots).toBe(1);
    expect(first.totalRosterSlots).toBe(28);
    expect(first.history.map(item => item.playerName)).toEqual(["Player 0"]);
    expect(first.teams.find(team => team.seasonTeamId === alpha)?.roster.map(item => item.playerName)).toEqual(["Player 0"]);
    expect(first.teams.find(team => team.seasonTeamId === alpha)?.positionCounts.QB).toBe(1);
    expect(first.teams.find(team => team.seasonTeamId === alpha)?.openSlots).toBe(13);
    expect(first.teams.find(team => team.seasonTeamId === alpha)?.legalNextPositions).toContain("RB");
    await store.close();
  });
  it("uses the unchanged Phase 1 limits and one shared FLEX for partial rosters", async () => { const { store, seasonId } = await seeded([120], 28); const order = await store.calculate(command(seasonId, "CALC")); const team = order.order[0]!.seasonTeamId; for (const id of ["p-0", "p-1"]) await store.makePick(command(seasonId, `P-${id}`), { seasonTeamId: team, playerId: id, rosterRules: rules }); await expect(store.makePick(command(seasonId, "QB-OVER"), { seasonTeamId: team, playerId: "p-14", rosterRules: rules })).rejects.toThrow("ROSTER_CAPACITY_EXCEEDED"); for (const id of ["p-2", "p-3", "p-4"]) await store.makePick(command(seasonId, `P-${id}`), { seasonTeamId: team, playerId: id, rosterRules: rules }); await expect(store.makePick(command(seasonId, "FLEX-OVER"), { seasonTeamId: team, playerId: "p-16", rosterRules: rules })).rejects.toThrow("ROSTER_CAPACITY_EXCEEDED"); await store.close(); });
  it("uses A-B-C-A order, rejects wrong/unavailable/overflow picks, and retries idempotently", async () => { const { store, seasonId, teams } = await seeded([120, 110, 100]); const order = await store.calculate(command(seasonId, "CALC")); const a = order.order[0]!.seasonTeamId, b = order.order[1]!.seasonTeamId, c = order.order[2]!.seasonTeamId; await expect(store.makePick(command(seasonId, "WRONG"), { seasonTeamId: b, playerId: "p-0", rosterRules: rules })).rejects.toThrow("on the clock"); let result = await store.makePick(command(seasonId, "P1", "same-pick"), { seasonTeamId: a, playerId: "p-0", rosterRules: rules }); const retry = await store.makePick(command(seasonId, "P1", "same-pick"), { seasonTeamId: a, playerId: "p-0", rosterRules: rules }); expect(retry.nextOverallPick).toBe(result.nextOverallPick); await expect(store.makePick(command(seasonId, "UNAVAILABLE"), { seasonTeamId: b, playerId: "p-0", rosterRules: rules })).rejects.toThrow("unavailable"); result = await store.makePick(command(seasonId, "P2"), { seasonTeamId: b, playerId: "p-1", rosterRules: rules }); result = await store.makePick(command(seasonId, "P3"), { seasonTeamId: c, playerId: "p-2", rosterRules: rules }); expect(result.currentSeasonTeamId).toBe(a); expect(result.nextOverallPick).toBe(4); await store.close(); });
  it("completes only with exactly 14 legal players per team and never snakes", async () => { const { store, seasonId } = await seeded([120, 110]); const order = await store.calculate(command(seasonId, "CALC")); const ids = order.order.map(item => item.seasonTeamId); for (let round = 0; round < 14; round++) for (let position = 0; position < 2; position++) { const overall = round * 2 + position; const result = await store.makePick(command(seasonId, `PICK-${overall}`), { seasonTeamId: ids[position]!, playerId: `p-${position * 14 + round}`, rosterRules: rules }); if (overall < 27) expect(result.currentSeasonTeamId).toBe(ids[(position + 1) % 2]); else expect(result.status).toBe("COMPLETED"); } expect((await store.getSeason(actor, seasonId))!.state).toBe(LifecycleState.COMPLETED); await store.close(); });
});
