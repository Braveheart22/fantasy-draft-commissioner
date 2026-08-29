BEGIN;
CREATE TABLE "PricePreparationBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,"seasonId" TEXT NOT NULL,"sourceLabel" TEXT NOT NULL,"format" TEXT NOT NULL,"sourceHash" TEXT NOT NULL,"normalizedHash" TEXT NOT NULL,"expectedSeasonVersion" INTEGER NOT NULL,"state" TEXT NOT NULL,"rowCount" INTEGER NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"approvedAt" DATETIME,"supersededAt" DATETIME,
  CONSTRAINT "PricePreparationBatch_seasonId_fkey" FOREIGN KEY("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PricePreparationBatch_seasonId_sourceHash_key" ON "PricePreparationBatch"("seasonId","sourceHash");
CREATE INDEX "PricePreparationBatch_seasonId_state_createdAt_idx" ON "PricePreparationBatch"("seasonId","state","createdAt");
CREATE TABLE "PricePreparationRow" (
  "id" TEXT NOT NULL PRIMARY KEY,"batchId" TEXT NOT NULL,"rowNumber" INTEGER NOT NULL,"sourceNamespace" TEXT,"sourceId" TEXT,"name" TEXT NOT NULL,"nflTeam" TEXT,"position" TEXT NOT NULL,"minimumBid" INTEGER NOT NULL,"matchKind" TEXT NOT NULL,"matchedPlayerId" TEXT,"reviewMessage" TEXT,"disposition" TEXT,"resolutionPlayerId" TEXT,
  CONSTRAINT "PricePreparationRow_batchId_fkey" FOREIGN KEY("batchId") REFERENCES "PricePreparationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PricePreparationRow_batchId_rowNumber_key" ON "PricePreparationRow"("batchId","rowNumber");
CREATE INDEX "PricePreparationRow_batchId_matchKind_disposition_idx" ON "PricePreparationRow"("batchId","matchKind","disposition");
CREATE TABLE "PlayerPriceAssignment" (
  "id" TEXT NOT NULL PRIMARY KEY,"seasonId" TEXT NOT NULL,"playerId" TEXT NOT NULL,"minimumBid" INTEGER NOT NULL,"sourceType" TEXT NOT NULL,"sourceLabel" TEXT NOT NULL,"sourceBatchId" TEXT,"active" INTEGER NOT NULL DEFAULT 1,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"supersededAt" DATETIME,
  CONSTRAINT "PlayerPriceAssignment_seasonId_fkey" FOREIGN KEY("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PlayerPriceAssignment_playerId_fkey" FOREIGN KEY("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PlayerPriceAssignment_sourceBatchId_fkey" FOREIGN KEY("sourceBatchId") REFERENCES "PricePreparationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "PlayerPriceAssignment_seasonId_playerId_active_sourceType_idx" ON "PlayerPriceAssignment"("seasonId","playerId","active","sourceType");
CREATE INDEX "PlayerPriceAssignment_sourceBatchId_idx" ON "PlayerPriceAssignment"("sourceBatchId");
INSERT INTO "PlayerPriceAssignment"("id","seasonId","playerId","minimumBid","sourceType","sourceLabel","active") SELECT lower(hex(randomblob(16))),"seasonId","id","explicitMinimumBid",'LEGACY','Migrated explicit minimum',1 FROM "Player" WHERE "explicitMinimumBid" IS NOT NULL;
UPDATE "SchemaMetadata" SET "version"=9,"applicationVersion"='0.1.0' WHERE "singleton"=1;
COMMIT;
