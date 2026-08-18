BEGIN;
CREATE TABLE "ExportRecord" ("id" TEXT NOT NULL PRIMARY KEY,"seasonId" TEXT NOT NULL,"backupId" TEXT NOT NULL,"jsonPath" TEXT NOT NULL,"jsonSha256" TEXT NOT NULL,"csvPath" TEXT NOT NULL,"csvSha256" TEXT NOT NULL,"schemaVersion" INTEGER NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"supersededAt" DATETIME,CONSTRAINT "ExportRecord_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE INDEX "ExportRecord_seasonId_createdAt_idx" ON "ExportRecord"("seasonId", "createdAt");
UPDATE "SchemaMetadata" SET "version"=6,"applicationVersion"='0.1.0' WHERE "singleton"=1;
COMMIT;
