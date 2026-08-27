BEGIN;
ALTER TABLE "Player" ADD COLUMN "nflTeam" TEXT;
ALTER TABLE "Player" ADD COLUMN "providerStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Player" ADD COLUMN "providerActive" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Player" ADD COLUMN "leagueSelectable" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Player" ADD COLUMN "normalizedSearchText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Player" ADD COLUMN "sourceUpdatedAt" DATETIME;
ALTER TABLE "Player" ADD COLUMN "catalogSnapshotId" TEXT REFERENCES "CatalogSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PlayerSourceAlias" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "seasonId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "sourceNamespace" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerSourceAlias_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PlayerSourceAlias_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlayerSourceAlias_seasonId_sourceNamespace_sourceId_key" ON "PlayerSourceAlias"("seasonId", "sourceNamespace", "sourceId");
CREATE UNIQUE INDEX "PlayerSourceAlias_playerId_sourceNamespace_key" ON "PlayerSourceAlias"("playerId", "sourceNamespace");
CREATE INDEX "PlayerSourceAlias_playerId_idx" ON "PlayerSourceAlias"("playerId");

CREATE TABLE "CatalogSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "seasonId" TEXT NOT NULL,
  "sourceNamespace" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "normalizedHash" TEXT NOT NULL,
  "sourceUpdatedAt" DATETIME,
  "approvedAt" DATETIME,
  "supersedesId" TEXT,
  "supersededAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogSnapshot_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CatalogSnapshot_seasonId_sourceNamespace_sourceHash_key" ON "CatalogSnapshot"("seasonId", "sourceNamespace", "sourceHash");
CREATE INDEX "CatalogSnapshot_seasonId_sourceNamespace_state_supersededAt_idx" ON "CatalogSnapshot"("seasonId", "sourceNamespace", "state", "supersededAt");
INSERT INTO "CatalogSnapshot"("id","seasonId","sourceNamespace","state","sourceHash","normalizedHash","approvedAt","supersedesId","supersededAt","createdAt")
SELECT "id","seasonId","sourceNamespace",CASE WHEN "supersededAt" IS NULL THEN 'APPROVED' ELSE 'SUPERSEDED' END,"sha256","sha256","createdAt","supersedesId","supersededAt","createdAt" FROM "PlayerImportBatch";

UPDATE "Player"
SET "normalizedSearchText" = lower(trim("name")),
    "providerStatus" = CASE WHEN "custom"=1 OR "available"=1 OR EXISTS (SELECT 1 FROM "RosterAssignment" r WHERE r."playerId"="Player"."id" AND r."supersededAt" IS NULL) THEN 'ACTIVE' ELSE 'INACTIVE' END,
    "providerActive" = CASE WHEN "custom"=1 OR "available"=1 OR EXISTS (SELECT 1 FROM "RosterAssignment" r WHERE r."playerId"="Player"."id" AND r."supersededAt" IS NULL) THEN 1 ELSE 0 END,
    "catalogSnapshotId" = "activeImportBatchId";
INSERT INTO "PlayerSourceAlias"("id","seasonId","playerId","sourceNamespace","sourceId")
SELECT lower(hex(randomblob(16))),"seasonId","id","sourceNamespace","externalId" FROM "Player" WHERE "sourceNamespace" IS NOT NULL AND "externalId" IS NOT NULL;

CREATE INDEX "Player_seasonId_normalizedSearchText_idx" ON "Player"("seasonId", "normalizedSearchText");
CREATE INDEX "Player_seasonId_nflTeam_position_idx" ON "Player"("seasonId", "nflTeam", "position");
CREATE INDEX "Player_seasonId_providerActive_leagueSelectable_idx" ON "Player"("seasonId", "providerActive", "leagueSelectable");
UPDATE "SchemaMetadata" SET "version"=7,"applicationVersion"='0.1.0' WHERE "singleton"=1;
COMMIT;
