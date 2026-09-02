import type Database from "better-sqlite3";
import type { CorrectionType, DependencyItem } from "./correction-types.js";

type DependencyRow = { id: string; orderValue?: number; label?: string };
const rows = (db: Database.Database, sql: string, values: unknown[] = []) => db.prepare(sql).all(...values) as DependencyRow[];
const PREPARATION_TYPES: CorrectionType[] = ["CATALOG_BATCH", "CUSTOM_PLAYER", "POSITION_FLOORS", "PRICE_BATCH", "MANUAL_PRICE"];

export function dependencyCut(db: Database.Database, seasonId: string, type: CorrectionType, targetId?: string): DependencyItem[] {
  const result: DependencyItem[] = [];
  const add = (entityType: string, found: DependencyRow[]) => found.forEach((item, index) => result.push({ entityType, id: item.id, order: item.orderValue ?? index, ...(item.label ? { label: item.label } : {}) }));
  const active = (table: string) => add(table, rows(db, `SELECT id FROM ${table} WHERE seasonId=? AND supersededAt IS NULL`, [seasonId]));
  const addDraft = () => {
    add("DraftPick", rows(db, "SELECT p.id,p.overallPick orderValue FROM DraftPick p JOIN ConventionalDraft d ON d.id=p.conventionalDraftId WHERE d.seasonId=? AND p.active=1 ORDER BY p.overallPick", [seasonId]));
    add("DraftOrderEntry", rows(db, "SELECT e.id FROM DraftOrderEntry e JOIN ConventionalDraft d ON d.id=e.conventionalDraftId WHERE d.seasonId=? AND e.supersededAt IS NULL", [seasonId]));
    add("DraftOrderTieDecision", rows(db, "SELECT t.id FROM DraftOrderTieDecision t JOIN ConventionalDraft d ON d.id=t.conventionalDraftId WHERE d.seasonId=? AND t.supersededAt IS NULL", [seasonId]));
  };
  const addRounds = (roundNumbers: number[]) => {
    for (const round of roundNumbers) {
      add("AuctionRound", rows(db, "SELECT id FROM AuctionRound WHERE seasonId=? AND roundNumber=? AND supersededAt IS NULL", [seasonId, round]));
      add("AuctionAttempt", rows(db, "SELECT a.id FROM AuctionAttempt a JOIN AuctionRound r ON r.id=a.roundId WHERE r.seasonId=? AND r.roundNumber=? AND a.supersededAt IS NULL", [seasonId, round]));
      add("AuctionTieDecision", rows(db, "SELECT t.id FROM AuctionTieDecision t JOIN AuctionRound r ON r.id=t.roundId WHERE r.seasonId=? AND r.roundNumber=? AND t.supersededAt IS NULL", [seasonId, round]));
      add("AuctionAward", rows(db, "SELECT a.id FROM AuctionAward a JOIN AuctionRound r ON r.id=a.roundId WHERE r.seasonId=? AND r.roundNumber=? AND a.supersededAt IS NULL", [seasonId, round]));
      add("TeamAuctionBalance", rows(db, "SELECT id FROM TeamAuctionBalance WHERE seasonId=? AND roundNumber=? AND supersededAt IS NULL", [seasonId, round]));
    }
  };

  active("ExportRecord");
  if (type === "PICK") {
    const target = db.prepare("SELECT p.overallPick FROM DraftPick p JOIN ConventionalDraft d ON d.id=p.conventionalDraftId WHERE p.id=? AND p.active=1 AND d.seasonId=?").get(targetId, seasonId) as { overallPick: number } | undefined;
    if (!target) throw new Error("Active draft pick not found");
    add("DraftPick", rows(db, "SELECT p.id,p.overallPick orderValue FROM DraftPick p JOIN ConventionalDraft d ON d.id=p.conventionalDraftId WHERE d.seasonId=? AND p.active=1 AND p.overallPick>=? ORDER BY p.overallPick", [seasonId, target.overallPick]));
  } else if (type === "AUCTION_REOPEN") {
    if (!targetId) throw new Error("Auction round target is required");
    const target = db.prepare("SELECT id FROM AuctionRound WHERE id=? AND seasonId=? AND supersededAt IS NULL").get(targetId, seasonId);
    if (!target) throw new Error("Active auction round target not found");
    add("AuctionAttempt", rows(db, "SELECT id FROM AuctionAttempt WHERE roundId=? AND supersededAt IS NULL", [targetId]));
    add("AuctionTieDecision", rows(db, "SELECT id FROM AuctionTieDecision WHERE roundId=? AND supersededAt IS NULL", [targetId]));
  } else {
    if (["KEEPER", "ROUND_1", "ROUND_2", "DRAFT_ORDER", ...PREPARATION_TYPES].includes(type)) addDraft();
    addRounds(type === "ROUND_2" ? [2] : type === "DRAFT_ORDER" ? [] : [1, 2]);
    if (type === "KEEPER" || PREPARATION_TYPES.includes(type)) active("KeeperSelection");

    if (PREPARATION_TYPES.includes(type)) {
      if (type !== "POSITION_FLOORS" && !targetId) throw new Error("Preparation correction target is required");
      if (type === "CATALOG_BATCH") {
        add("CatalogPreparationBatch", rows(db, "SELECT id,sourceNamespace || ' catalog batch' label FROM CatalogPreparationBatch WHERE id=? AND seasonId=? AND state='APPROVED'", [targetId, seasonId]));
        add("CatalogSnapshot", rows(db, "SELECT id,sourceNamespace || ' approved catalog' label FROM CatalogSnapshot WHERE id=? AND seasonId=? AND supersededAt IS NULL", [targetId, seasonId]));
        add("PlayerImportBatch", rows(db, "SELECT id,sourceNamespace || ' active import lineage' label FROM PlayerImportBatch WHERE id=? AND seasonId=? AND supersededAt IS NULL", [targetId, seasonId]));
        add("Player", rows(db, "SELECT id,name || ' (' || position || ')' label FROM Player WHERE seasonId=? AND catalogSnapshotId=? AND supersededAt IS NULL", [seasonId, targetId]));
        add("PricePreparationBatch", rows(db, "SELECT DISTINCT b.id,b.sourceLabel || ' dependent price batch' label FROM PricePreparationBatch b JOIN PlayerPriceAssignment a ON a.sourceBatchId=b.id JOIN Player p ON p.id=a.playerId WHERE b.seasonId=? AND b.state='APPROVED' AND b.supersededAt IS NULL AND p.catalogSnapshotId=?", [seasonId, targetId]));
        add("PlayerPriceAssignment", rows(db, "SELECT DISTINCT a.id,p.name || ': $' || a.minimumBid || ' dependent price' label FROM PlayerPriceAssignment a JOIN Player p ON p.id=a.playerId WHERE a.seasonId=? AND a.active=1 AND (p.catalogSnapshotId=? OR a.sourceBatchId IN (SELECT DISTINCT sourceBatchId FROM PlayerPriceAssignment x JOIN Player xp ON xp.id=x.playerId WHERE xp.catalogSnapshotId=? AND sourceBatchId IS NOT NULL))", [seasonId, targetId, targetId]));
      } else if (type === "CUSTOM_PLAYER") {
        add("Player", rows(db, "SELECT id,name || ' (' || position || ') custom player' label FROM Player WHERE id=? AND seasonId=? AND custom=1 AND supersededAt IS NULL", [targetId, seasonId]));
        add("PricePreparationBatch", rows(db, "SELECT DISTINCT b.id,b.sourceLabel || ' dependent price batch' label FROM PricePreparationBatch b JOIN PlayerPriceAssignment a ON a.sourceBatchId=b.id WHERE b.seasonId=? AND b.state='APPROVED' AND b.supersededAt IS NULL AND a.playerId=?", [seasonId, targetId]));
        add("PlayerPriceAssignment", rows(db, "SELECT DISTINCT a.id,p.name || ': $' || a.minimumBid || ' dependent price' label FROM PlayerPriceAssignment a JOIN Player p ON p.id=a.playerId WHERE a.seasonId=? AND a.active=1 AND (a.playerId=? OR a.sourceBatchId IN (SELECT sourceBatchId FROM PlayerPriceAssignment WHERE playerId=? AND sourceBatchId IS NOT NULL))", [seasonId, targetId, targetId]));
      } else if (type === "POSITION_FLOORS") {
        add("PositionPriceFloor", rows(db, "SELECT id,position || ' floor: $' || minimumBid label FROM PositionPriceFloor WHERE seasonId=? AND supersededAt IS NULL", [seasonId]));
      } else if (type === "PRICE_BATCH") {
        add("PricePreparationBatch", rows(db, "SELECT id,sourceLabel || ' price batch' label FROM PricePreparationBatch WHERE id=? AND seasonId=? AND state='APPROVED' AND supersededAt IS NULL", [targetId, seasonId]));
        add("PlayerPriceAssignment", rows(db, "SELECT a.id,p.name || ': $' || a.minimumBid || ' from ' || a.sourceLabel label FROM PlayerPriceAssignment a JOIN Player p ON p.id=a.playerId WHERE a.seasonId=? AND a.sourceBatchId=? AND a.active=1", [seasonId, targetId]));
      } else {
        add("PlayerPriceAssignment", rows(db, "SELECT a.id,p.name || ': $' || a.minimumBid || ' manual price' label FROM PlayerPriceAssignment a JOIN Player p ON p.id=a.playerId WHERE a.id=? AND a.seasonId=? AND a.sourceType='MANUAL' AND a.active=1", [targetId, seasonId]));
      }
      const required: Partial<Record<CorrectionType, string>> = { CATALOG_BATCH: "CatalogPreparationBatch", CUSTOM_PLAYER: "Player", POSITION_FLOORS: "PositionPriceFloor", PRICE_BATCH: "PricePreparationBatch", MANUAL_PRICE: "PlayerPriceAssignment" };
      if (!result.some(item => item.entityType === required[type]) || (type === "CATALOG_BATCH" && !result.some(item => item.entityType === "CatalogSnapshot"))) throw new Error("Active preparation correction target not found");
    }
  }
  return result.sort((a, b) => a.entityType.localeCompare(b.entityType) || a.order - b.order || a.id.localeCompare(b.id));
}

export const resumeState = (type: CorrectionType) => PREPARATION_TYPES.includes(type) || type === "KEEPER" ? "SETUP" : type === "ROUND_1" ? "KEEPERS_LOCKED" : type === "ROUND_2" ? "R1_PUBLISHED" : type === "DRAFT_ORDER" ? "R2_PUBLISHED" : type === "AUCTION_REOPEN" ? "R1_BIDDING" : "CONVENTIONAL_DRAFT";
