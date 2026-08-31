-- Superseded rows remain immutable history. Only current rows occupy order/pick slots.
-- SQLite's original inline UNIQUE constraints require table rebuilds. Copy every
-- column and row before swapping tables, within one transaction on the migration copy.
BEGIN;
CREATE TABLE "DraftOrderEntry_next" ("id" TEXT NOT NULL PRIMARY KEY, "conventionalDraftId" TEXT NOT NULL, "orderPosition" INTEGER NOT NULL, "seasonTeamId" TEXT NOT NULL, "remainingBalance" INTEGER NOT NULL, "supersededAt" DATETIME, FOREIGN KEY ("conventionalDraftId") REFERENCES "ConventionalDraft"("id"), FOREIGN KEY ("seasonTeamId") REFERENCES "SeasonTeam"("id"));
INSERT INTO "DraftOrderEntry_next" SELECT * FROM "DraftOrderEntry";
DROP TABLE "DraftOrderEntry";
ALTER TABLE "DraftOrderEntry_next" RENAME TO "DraftOrderEntry";
CREATE UNIQUE INDEX "DraftOrderEntry_active_position" ON "DraftOrderEntry"("conventionalDraftId", "orderPosition") WHERE "supersededAt" IS NULL;
CREATE UNIQUE INDEX "DraftOrderEntry_active_team" ON "DraftOrderEntry"("conventionalDraftId", "seasonTeamId") WHERE "supersededAt" IS NULL;

CREATE TABLE "DraftOrderTieDecision_next" ("id" TEXT NOT NULL PRIMARY KEY, "conventionalDraftId" TEXT NOT NULL, "balance" INTEGER NOT NULL, "participantTeamIdsJson" TEXT NOT NULL, "precedenceTeamIdsJson" TEXT NOT NULL, "method" TEXT NOT NULL, "note" TEXT, "decidedAt" TEXT NOT NULL, "supersededAt" DATETIME, FOREIGN KEY ("conventionalDraftId") REFERENCES "ConventionalDraft"("id"));
INSERT INTO "DraftOrderTieDecision_next" SELECT * FROM "DraftOrderTieDecision";
DROP TABLE "DraftOrderTieDecision";
ALTER TABLE "DraftOrderTieDecision_next" RENAME TO "DraftOrderTieDecision";
CREATE UNIQUE INDEX "DraftOrderTieDecision_active_balance" ON "DraftOrderTieDecision"("conventionalDraftId", "balance") WHERE "supersededAt" IS NULL;

CREATE TABLE "DraftPick_next" ("id" TEXT NOT NULL PRIMARY KEY, "conventionalDraftId" TEXT NOT NULL, "overallPick" INTEGER NOT NULL, "roundNumber" INTEGER NOT NULL, "orderPosition" INTEGER NOT NULL, "seasonTeamId" TEXT NOT NULL, "playerId" TEXT NOT NULL, "active" INTEGER NOT NULL DEFAULT 1, "supersededAt" TEXT, "createdAt" TEXT NOT NULL, FOREIGN KEY ("conventionalDraftId") REFERENCES "ConventionalDraft"("id"), FOREIGN KEY ("seasonTeamId") REFERENCES "SeasonTeam"("id"));
INSERT INTO "DraftPick_next" SELECT * FROM "DraftPick";
DROP TABLE "DraftPick";
ALTER TABLE "DraftPick_next" RENAME TO "DraftPick";
CREATE UNIQUE INDEX "DraftPick_active_overall" ON "DraftPick"("conventionalDraftId", "overallPick") WHERE "active" = 1;
CREATE UNIQUE INDEX "DraftPick_active_player" ON "DraftPick"("conventionalDraftId", "playerId") WHERE "active" = 1;
UPDATE "SchemaMetadata" SET "version"=10 WHERE "singleton"=1;
COMMIT;
