BEGIN;
ALTER TABLE "Player" ADD COLUMN "supersedesPlayerId" TEXT;
ALTER TABLE "Player" ADD COLUMN "supersededAt" DATETIME;
CREATE TABLE "CatalogPreparationBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "seasonId" TEXT NOT NULL,
  "sourceNamespace" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "normalizedHash" TEXT NOT NULL,
  "expectedSeasonVersion" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME,
  "approvedAt" DATETIME,
  CONSTRAINT "CatalogPreparationBatch_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CatalogPreparationBatch_seasonId_sourceNamespace_sourceHash_key" ON "CatalogPreparationBatch"("seasonId", "sourceNamespace", "sourceHash");
CREATE INDEX "CatalogPreparationBatch_seasonId_state_createdAt_idx" ON "CatalogPreparationBatch"("seasonId", "state", "createdAt");

CREATE TABLE "CatalogPreparationRow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "operation" TEXT NOT NULL DEFAULT 'UPSERT',
  "externalId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "nflTeam" TEXT,
  "providerStatus" TEXT NOT NULL,
  "providerActive" INTEGER NOT NULL,
  "leagueSelectable" INTEGER NOT NULL,
  "sourceUpdatedAt" DATETIME,
  "aliasesJson" TEXT NOT NULL,
  "reviewKind" TEXT,
  "reviewMessage" TEXT,
  "disposition" TEXT,
  "resolutionPlayerId" TEXT,
  CONSTRAINT "CatalogPreparationRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CatalogPreparationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CatalogPreparationRow_batchId_rowNumber_key" ON "CatalogPreparationRow"("batchId", "rowNumber");
CREATE INDEX "CatalogPreparationRow_batchId_reviewKind_disposition_idx" ON "CatalogPreparationRow"("batchId", "reviewKind", "disposition");
UPDATE "SchemaMetadata" SET "version"=8,"applicationVersion"='0.1.0' WHERE "singleton"=1;
COMMIT;
