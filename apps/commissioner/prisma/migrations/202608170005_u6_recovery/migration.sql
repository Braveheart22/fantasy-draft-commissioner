BEGIN;
CREATE TABLE "BackupRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "seasonId" TEXT,
  "path" TEXT NOT NULL,
  "manifestPath" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "applicationVersion" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "seasonVersion" INTEGER,
  "dependencyCutHash" TEXT,
  "verifiedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CorrectionAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "seasonId" TEXT NOT NULL,
  "correctionType" TEXT NOT NULL,
  "targetId" TEXT,
  "requestedAuditEventId" TEXT,
  "rollbackCheckpointId" TEXT,
  "seasonVersion" INTEGER NOT NULL,
  "dependencyCutHash" TEXT NOT NULL,
  "impactJson" TEXT NOT NULL,
  "backupHash" TEXT,
  "reason" TEXT,
  "confirmedAt" DATETIME,
  "resultAuditEventId" TEXT,
  "supersededAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionAction_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CorrectionAction_seasonId_createdAt_idx" ON "CorrectionAction"("seasonId", "createdAt");
ALTER TABLE "KeeperSelection" ADD COLUMN "supersededAt" DATETIME;
ALTER TABLE "AuctionAward" ADD COLUMN "supersededAt" DATETIME;
ALTER TABLE "TeamAuctionBalance" ADD COLUMN "supersededAt" DATETIME;
ALTER TABLE "DraftOrderEntry" ADD COLUMN "supersededAt" DATETIME;
ALTER TABLE "DraftOrderTieDecision" ADD COLUMN "supersededAt" DATETIME;
UPDATE "SchemaMetadata" SET "version"=5, "applicationVersion"='0.1.0' WHERE "singleton"=1;
COMMIT;
