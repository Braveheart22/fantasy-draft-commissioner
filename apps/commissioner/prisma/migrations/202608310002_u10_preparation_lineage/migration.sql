BEGIN;
CREATE TABLE "PositionPriceFloor_next" ("id" TEXT NOT NULL PRIMARY KEY, "seasonId" TEXT NOT NULL, "position" TEXT NOT NULL, "minimumBid" INTEGER NOT NULL CHECK("minimumBid" > 0), "supersededAt" DATETIME, FOREIGN KEY ("seasonId") REFERENCES "Season"("id"));
INSERT INTO "PositionPriceFloor_next" ("id","seasonId","position","minimumBid") SELECT "id","seasonId","position","minimumBid" FROM "PositionPriceFloor";
DROP TABLE "PositionPriceFloor";
ALTER TABLE "PositionPriceFloor_next" RENAME TO "PositionPriceFloor";
CREATE UNIQUE INDEX "PositionPriceFloor_active_position" ON "PositionPriceFloor"("seasonId","position") WHERE "supersededAt" IS NULL;
UPDATE "SchemaMetadata" SET "version"=11 WHERE "singleton"=1;
COMMIT;
