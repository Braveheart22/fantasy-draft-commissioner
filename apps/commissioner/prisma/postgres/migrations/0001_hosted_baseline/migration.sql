--
-- PostgreSQL database dump
--

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AuctionAttempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuctionAttempt" (
    id text NOT NULL,
    "roundId" text NOT NULL,
    "attemptNumber" integer NOT NULL,
    "inputJson" text NOT NULL,
    "inputHash" text NOT NULL,
    "outputJson" text NOT NULL,
    "outputHash" text NOT NULL,
    "eliminationsJson" text NOT NULL,
    "traceJson" text NOT NULL,
    status text NOT NULL,
    "contractVersion" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: AuctionAward; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuctionAward" (
    id text NOT NULL,
    "roundId" text NOT NULL,
    "seasonTeamId" text NOT NULL,
    "playerId" text NOT NULL,
    amount integer NOT NULL,
    "bidId" text NOT NULL,
    "sourceAttemptId" text NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: AuctionRound; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuctionRound" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "roundNumber" integer NOT NULL,
    status text NOT NULL,
    "inputSnapshotId" text,
    "inputHash" text,
    "contractVersion" text,
    "publishedAt" timestamp(3) without time zone,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: AuctionSubmission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuctionSubmission" (
    id text NOT NULL,
    "roundId" text NOT NULL,
    "seasonTeamId" text NOT NULL,
    status text NOT NULL,
    "zeroConfirmed" boolean DEFAULT false NOT NULL,
    "bidsJson" text NOT NULL,
    "bidCount" integer NOT NULL,
    "submissionVersion" integer DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: AuctionTieDecision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuctionTieDecision" (
    id text NOT NULL,
    "roundId" text NOT NULL,
    "tieKey" text NOT NULL,
    "playerId" text NOT NULL,
    amount integer NOT NULL,
    "participantTeamIdsJson" text NOT NULL,
    "preferredTeamId" text NOT NULL,
    method text NOT NULL,
    note text,
    "decidedAt" timestamp(3) without time zone NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: AuditEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuditEvent" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    sequence integer NOT NULL,
    "actorType" text NOT NULL,
    "actorLabel" text NOT NULL,
    "actorSubjectId" text NOT NULL,
    "actorRole" text NOT NULL,
    "commandType" text NOT NULL,
    "entityType" text,
    "entityId" text,
    "correlationId" text NOT NULL,
    "idempotencyKey" text NOT NULL,
    reason text,
    "beforeJson" text,
    "afterJson" text,
    "resultJson" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: BackupRecord; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BackupRecord" (
    id text NOT NULL,
    "seasonId" text,
    path text NOT NULL,
    "manifestPath" text NOT NULL,
    sha256 text NOT NULL,
    "schemaVersion" integer NOT NULL,
    "applicationVersion" text NOT NULL,
    trigger text NOT NULL,
    "seasonVersion" integer,
    "dependencyCutHash" text,
    "verifiedAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: CatalogPreparationBatch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CatalogPreparationBatch" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "sourceNamespace" text NOT NULL,
    format text NOT NULL,
    "sourceHash" text NOT NULL,
    "normalizedHash" text NOT NULL,
    "expectedSeasonVersion" integer NOT NULL,
    state text NOT NULL,
    "rowCount" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "approvedAt" timestamp(3) without time zone
);


--
-- Name: CatalogPreparationRow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CatalogPreparationRow" (
    id text NOT NULL,
    "batchId" text NOT NULL,
    "rowNumber" integer NOT NULL,
    operation text DEFAULT 'UPSERT'::text NOT NULL,
    "externalId" text NOT NULL,
    name text NOT NULL,
    "position" text NOT NULL,
    "nflTeam" text,
    "providerStatus" text NOT NULL,
    "providerActive" boolean NOT NULL,
    "leagueSelectable" boolean NOT NULL,
    "sourceUpdatedAt" timestamp(3) without time zone,
    "aliasesJson" text NOT NULL,
    "reviewKind" text,
    "reviewMessage" text,
    disposition text,
    "resolutionPlayerId" text
);


--
-- Name: CatalogSnapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CatalogSnapshot" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "sourceNamespace" text NOT NULL,
    state text NOT NULL,
    "sourceHash" text NOT NULL,
    "normalizedHash" text NOT NULL,
    "sourceUpdatedAt" timestamp(3) without time zone,
    "approvedAt" timestamp(3) without time zone,
    "supersedesId" text,
    "supersededAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Checkpoint; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Checkpoint" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    kind text NOT NULL,
    "seasonVersion" integer NOT NULL,
    "stateSnapshotId" text NOT NULL,
    "sourceAuditEventId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: CommandReceipt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CommandReceipt" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "actorSubjectId" text NOT NULL,
    "idempotencyKey" text NOT NULL,
    "commandType" text NOT NULL,
    "commandFingerprint" text NOT NULL,
    "resultJson" text NOT NULL,
    "auditEventId" text NOT NULL,
    "seasonRevision" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ConventionalDraft; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ConventionalDraft" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    status text NOT NULL,
    "orderSnapshotId" text,
    "orderHash" text,
    "contractVersion" text NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: CorrectionAction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CorrectionAction" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "correctionType" text NOT NULL,
    "targetId" text,
    "requestedAuditEventId" text,
    "rollbackCheckpointId" text,
    "seasonVersion" integer NOT NULL,
    "dependencyCutHash" text NOT NULL,
    "impactJson" text NOT NULL,
    "backupHash" text,
    reason text,
    "confirmedAt" timestamp(3) without time zone,
    "resultAuditEventId" text,
    "supersededAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: DraftOrderEntry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DraftOrderEntry" (
    id text NOT NULL,
    "conventionalDraftId" text NOT NULL,
    "orderPosition" integer NOT NULL,
    "seasonTeamId" text NOT NULL,
    "remainingBalance" integer NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: DraftOrderTieDecision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DraftOrderTieDecision" (
    id text NOT NULL,
    "conventionalDraftId" text NOT NULL,
    balance integer NOT NULL,
    "participantTeamIdsJson" text NOT NULL,
    "precedenceTeamIdsJson" text NOT NULL,
    method text NOT NULL,
    note text,
    "decidedAt" timestamp(3) without time zone NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: DraftPick; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DraftPick" (
    id text NOT NULL,
    "conventionalDraftId" text NOT NULL,
    "overallPick" integer NOT NULL,
    "roundNumber" integer NOT NULL,
    "orderPosition" integer NOT NULL,
    "seasonTeamId" text NOT NULL,
    "playerId" text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "supersededAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ExportRecord; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ExportRecord" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "backupId" text NOT NULL,
    "jsonPath" text NOT NULL,
    "jsonSha256" text NOT NULL,
    "csvPath" text NOT NULL,
    "csvSha256" text NOT NULL,
    "schemaVersion" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: FrozenSnapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FrozenSnapshot" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    kind text NOT NULL,
    "schemaVersion" integer NOT NULL,
    "payloadJson" text NOT NULL,
    sha256 text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "sourceAuditEventId" text NOT NULL
);


--
-- Name: KeeperSelection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."KeeperSelection" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "seasonTeamId" text NOT NULL,
    "playerId" text NOT NULL,
    cost integer DEFAULT 50 NOT NULL,
    "startingBudget" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: League; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."League" (
    id text NOT NULL,
    name text NOT NULL
);


--
-- Name: OutboxEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OutboxEvent" (
    cursor bigint NOT NULL,
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "seasonRevision" integer NOT NULL,
    "projectionKind" text NOT NULL,
    "commandType" text NOT NULL,
    "correlationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: OutboxEvent_cursor_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."OutboxEvent_cursor_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: OutboxEvent_cursor_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."OutboxEvent_cursor_seq" OWNED BY public."OutboxEvent".cursor;


--
-- Name: Player; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Player" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    name text NOT NULL,
    "position" text NOT NULL,
    "sourceType" text NOT NULL,
    "sourceNamespace" text,
    "externalId" text,
    "nflTeam" text,
    "providerStatus" text DEFAULT 'ACTIVE'::text NOT NULL,
    "providerActive" boolean DEFAULT true NOT NULL,
    "leagueSelectable" boolean DEFAULT true NOT NULL,
    "normalizedSearchText" text DEFAULT ''::text NOT NULL,
    "sourceUpdatedAt" timestamp(3) without time zone,
    "catalogSnapshotId" text,
    "supersedesPlayerId" text,
    "supersededAt" timestamp(3) without time zone,
    custom boolean DEFAULT false NOT NULL,
    "explicitMinimumBid" integer,
    available boolean DEFAULT true NOT NULL,
    "keeperEligible" boolean DEFAULT false NOT NULL,
    "activeImportBatchId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: PlayerImportBatch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PlayerImportBatch" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "sourceNamespace" text NOT NULL,
    format text NOT NULL,
    sha256 text NOT NULL,
    "rowCount" integer NOT NULL,
    "supersedesId" text,
    "supersededAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: PlayerPriceAssignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PlayerPriceAssignment" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "playerId" text NOT NULL,
    "minimumBid" integer NOT NULL,
    "sourceType" text NOT NULL,
    "sourceLabel" text NOT NULL,
    "sourceBatchId" text,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: PlayerSourceAlias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PlayerSourceAlias" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "playerId" text NOT NULL,
    "sourceNamespace" text NOT NULL,
    "sourceId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: PositionPriceFloor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PositionPriceFloor" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "position" text NOT NULL,
    "minimumBid" integer NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: PricePreparationBatch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PricePreparationBatch" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "sourceLabel" text NOT NULL,
    format text NOT NULL,
    "sourceHash" text NOT NULL,
    "normalizedHash" text NOT NULL,
    "expectedSeasonVersion" integer NOT NULL,
    state text NOT NULL,
    "rowCount" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "approvedAt" timestamp(3) without time zone,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: PricePreparationRow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PricePreparationRow" (
    id text NOT NULL,
    "batchId" text NOT NULL,
    "rowNumber" integer NOT NULL,
    "sourceNamespace" text,
    "sourceId" text,
    name text NOT NULL,
    "nflTeam" text,
    "position" text NOT NULL,
    "minimumBid" integer NOT NULL,
    "matchKind" text NOT NULL,
    "matchedPlayerId" text,
    "reviewMessage" text,
    disposition text,
    "resolutionPlayerId" text
);


--
-- Name: RosterAssignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RosterAssignment" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "seasonTeamId" text NOT NULL,
    "playerId" text NOT NULL,
    "acquisitionSource" text NOT NULL,
    "auctionRound" integer,
    cost integer,
    "sourceEntityId" text NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: SchemaMetadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SchemaMetadata" (
    singleton integer DEFAULT 1 NOT NULL,
    version integer NOT NULL,
    "applicationVersion" text NOT NULL
);


--
-- Name: Season; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Season" (
    id text NOT NULL,
    "leagueId" text NOT NULL,
    year integer NOT NULL,
    name text NOT NULL,
    state text NOT NULL,
    "teamCount" integer NOT NULL,
    "rowVersion" integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: SeasonTeam; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SeasonTeam" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "teamId" text NOT NULL,
    "displayName" text NOT NULL,
    "seedOrder" integer NOT NULL,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: Team; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Team" (
    id text NOT NULL,
    "leagueId" text NOT NULL,
    "franchiseName" text NOT NULL
);


--
-- Name: TeamAuctionBalance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TeamAuctionBalance" (
    id text NOT NULL,
    "seasonId" text NOT NULL,
    "seasonTeamId" text NOT NULL,
    "roundNumber" integer NOT NULL,
    "startingBudget" integer NOT NULL,
    spent integer NOT NULL,
    "remainingBudget" integer NOT NULL,
    "supersededAt" timestamp(3) without time zone
);


--
-- Name: OutboxEvent cursor; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OutboxEvent" ALTER COLUMN cursor SET DEFAULT nextval('public."OutboxEvent_cursor_seq"'::regclass);


--
-- Name: AuctionAttempt AuctionAttempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuctionAttempt"
    ADD CONSTRAINT "AuctionAttempt_pkey" PRIMARY KEY (id);


--
-- Name: AuctionAward AuctionAward_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuctionAward"
    ADD CONSTRAINT "AuctionAward_pkey" PRIMARY KEY (id);


--
-- Name: AuctionRound AuctionRound_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuctionRound"
    ADD CONSTRAINT "AuctionRound_pkey" PRIMARY KEY (id);


--
-- Name: AuctionSubmission AuctionSubmission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuctionSubmission"
    ADD CONSTRAINT "AuctionSubmission_pkey" PRIMARY KEY (id);


--
-- Name: AuctionTieDecision AuctionTieDecision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuctionTieDecision"
    ADD CONSTRAINT "AuctionTieDecision_pkey" PRIMARY KEY (id);


--
-- Name: AuditEvent AuditEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditEvent"
    ADD CONSTRAINT "AuditEvent_pkey" PRIMARY KEY (id);


--
-- Name: BackupRecord BackupRecord_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BackupRecord"
    ADD CONSTRAINT "BackupRecord_pkey" PRIMARY KEY (id);


--
-- Name: CatalogPreparationBatch CatalogPreparationBatch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CatalogPreparationBatch"
    ADD CONSTRAINT "CatalogPreparationBatch_pkey" PRIMARY KEY (id);


--
-- Name: CatalogPreparationRow CatalogPreparationRow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CatalogPreparationRow"
    ADD CONSTRAINT "CatalogPreparationRow_pkey" PRIMARY KEY (id);


--
-- Name: CatalogSnapshot CatalogSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CatalogSnapshot"
    ADD CONSTRAINT "CatalogSnapshot_pkey" PRIMARY KEY (id);


--
-- Name: Checkpoint Checkpoint_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checkpoint"
    ADD CONSTRAINT "Checkpoint_pkey" PRIMARY KEY (id);


--
-- Name: CommandReceipt CommandReceipt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CommandReceipt"
    ADD CONSTRAINT "CommandReceipt_pkey" PRIMARY KEY (id);


--
-- Name: ConventionalDraft ConventionalDraft_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ConventionalDraft"
    ADD CONSTRAINT "ConventionalDraft_pkey" PRIMARY KEY (id);


--
-- Name: CorrectionAction CorrectionAction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CorrectionAction"
    ADD CONSTRAINT "CorrectionAction_pkey" PRIMARY KEY (id);


--
-- Name: DraftOrderEntry DraftOrderEntry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DraftOrderEntry"
    ADD CONSTRAINT "DraftOrderEntry_pkey" PRIMARY KEY (id);


--
-- Name: DraftOrderTieDecision DraftOrderTieDecision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DraftOrderTieDecision"
    ADD CONSTRAINT "DraftOrderTieDecision_pkey" PRIMARY KEY (id);


--
-- Name: DraftPick DraftPick_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DraftPick"
    ADD CONSTRAINT "DraftPick_pkey" PRIMARY KEY (id);


--
-- Name: ExportRecord ExportRecord_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExportRecord"
    ADD CONSTRAINT "ExportRecord_pkey" PRIMARY KEY (id);


--
-- Name: FrozenSnapshot FrozenSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FrozenSnapshot"
    ADD CONSTRAINT "FrozenSnapshot_pkey" PRIMARY KEY (id);


--
-- Name: KeeperSelection KeeperSelection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KeeperSelection"
    ADD CONSTRAINT "KeeperSelection_pkey" PRIMARY KEY (id);


--
-- Name: League League_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."League"
    ADD CONSTRAINT "League_pkey" PRIMARY KEY (id);


--
-- Name: OutboxEvent OutboxEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OutboxEvent"
    ADD CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY (cursor);


--
-- Name: PlayerImportBatch PlayerImportBatch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PlayerImportBatch"
    ADD CONSTRAINT "PlayerImportBatch_pkey" PRIMARY KEY (id);


--
-- Name: PlayerPriceAssignment PlayerPriceAssignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PlayerPriceAssignment"
    ADD CONSTRAINT "PlayerPriceAssignment_pkey" PRIMARY KEY (id);


--
-- Name: PlayerSourceAlias PlayerSourceAlias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PlayerSourceAlias"
    ADD CONSTRAINT "PlayerSourceAlias_pkey" PRIMARY KEY (id);


--
-- Name: Player Player_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Player"
    ADD CONSTRAINT "Player_pkey" PRIMARY KEY (id);


--
-- Name: PositionPriceFloor PositionPriceFloor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PositionPriceFloor"
    ADD CONSTRAINT "PositionPriceFloor_pkey" PRIMARY KEY (id);


--
-- Name: PricePreparationBatch PricePreparationBatch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PricePreparationBatch"
    ADD CONSTRAINT "PricePreparationBatch_pkey" PRIMARY KEY (id);


--
-- Name: PricePreparationRow PricePreparationRow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PricePreparationRow"
    ADD CONSTRAINT "PricePreparationRow_pkey" PRIMARY KEY (id);


--
-- Name: RosterAssignment RosterAssignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RosterAssignment"
    ADD CONSTRAINT "RosterAssignment_pkey" PRIMARY KEY (id);


--
-- Name: SchemaMetadata SchemaMetadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SchemaMetadata"
    ADD CONSTRAINT "SchemaMetadata_pkey" PRIMARY KEY (singleton);


--
-- Name: SeasonTeam SeasonTeam_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SeasonTeam"
    ADD CONSTRAINT "SeasonTeam_pkey" PRIMARY KEY (id);


--
-- Name: Season Season_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Season"
    ADD CONSTRAINT "Season_pkey" PRIMARY KEY (id);


--
-- Name: TeamAuctionBalance TeamAuctionBalance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamAuctionBalance"
    ADD CONSTRAINT "TeamAuctionBalance_pkey" PRIMARY KEY (id);


--
-- Name: Team Team_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Team"
    ADD CONSTRAINT "Team_pkey" PRIMARY KEY (id);


--
-- Name: AuctionAttempt_roundId_attemptNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AuctionAttempt_roundId_attemptNumber_key" ON public."AuctionAttempt" USING btree ("roundId", "attemptNumber");


--
-- Name: AuctionAward_roundId_playerId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AuctionAward_roundId_playerId_key" ON public."AuctionAward" USING btree ("roundId", "playerId");


--
-- Name: AuctionRound_seasonId_roundNumber_supersededAt_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AuctionRound_seasonId_roundNumber_supersededAt_key" ON public."AuctionRound" USING btree ("seasonId", "roundNumber", "supersededAt");


--
-- Name: AuctionSubmission_roundId_seasonTeamId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AuctionSubmission_roundId_seasonTeamId_key" ON public."AuctionSubmission" USING btree ("roundId", "seasonTeamId");


--
-- Name: AuditEvent_seasonId_actorSubjectId_idempotencyKey_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditEvent_seasonId_actorSubjectId_idempotencyKey_idx" ON public."AuditEvent" USING btree ("seasonId", "actorSubjectId", "idempotencyKey");


--
-- Name: AuditEvent_seasonId_sequence_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AuditEvent_seasonId_sequence_key" ON public."AuditEvent" USING btree ("seasonId", sequence);


--
-- Name: CatalogPreparationBatch_seasonId_sourceNamespace_sourceHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CatalogPreparationBatch_seasonId_sourceNamespace_sourceHash_key" ON public."CatalogPreparationBatch" USING btree ("seasonId", "sourceNamespace", "sourceHash");


--
-- Name: CatalogPreparationBatch_seasonId_state_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CatalogPreparationBatch_seasonId_state_createdAt_idx" ON public."CatalogPreparationBatch" USING btree ("seasonId", state, "createdAt");


--
-- Name: CatalogPreparationRow_batchId_reviewKind_disposition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CatalogPreparationRow_batchId_reviewKind_disposition_idx" ON public."CatalogPreparationRow" USING btree ("batchId", "reviewKind", disposition);


--
-- Name: CatalogPreparationRow_batchId_rowNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CatalogPreparationRow_batchId_rowNumber_key" ON public."CatalogPreparationRow" USING btree ("batchId", "rowNumber");


--
-- Name: CatalogSnapshot_seasonId_sourceNamespace_sourceHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CatalogSnapshot_seasonId_sourceNamespace_sourceHash_key" ON public."CatalogSnapshot" USING btree ("seasonId", "sourceNamespace", "sourceHash");


--
-- Name: CatalogSnapshot_seasonId_sourceNamespace_state_supersededAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CatalogSnapshot_seasonId_sourceNamespace_state_supersededAt_idx" ON public."CatalogSnapshot" USING btree ("seasonId", "sourceNamespace", state, "supersededAt");


--
-- Name: CommandReceipt_auditEventId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CommandReceipt_auditEventId_key" ON public."CommandReceipt" USING btree ("auditEventId");


--
-- Name: CommandReceipt_seasonId_actorSubjectId_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CommandReceipt_seasonId_actorSubjectId_idempotencyKey_key" ON public."CommandReceipt" USING btree ("seasonId", "actorSubjectId", "idempotencyKey");


--
-- Name: ConventionalDraft_seasonId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ConventionalDraft_seasonId_key" ON public."ConventionalDraft" USING btree ("seasonId");


--
-- Name: CorrectionAction_seasonId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CorrectionAction_seasonId_createdAt_idx" ON public."CorrectionAction" USING btree ("seasonId", "createdAt");


--
-- Name: ExportRecord_seasonId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ExportRecord_seasonId_createdAt_idx" ON public."ExportRecord" USING btree ("seasonId", "createdAt");


--
-- Name: KeeperSelection_playerId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "KeeperSelection_playerId_key" ON public."KeeperSelection" USING btree ("playerId");


--
-- Name: KeeperSelection_seasonTeamId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "KeeperSelection_seasonTeamId_key" ON public."KeeperSelection" USING btree ("seasonTeamId");


--
-- Name: OutboxEvent_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OutboxEvent_createdAt_idx" ON public."OutboxEvent" USING btree ("createdAt");


--
-- Name: OutboxEvent_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OutboxEvent_id_key" ON public."OutboxEvent" USING btree (id);


--
-- Name: OutboxEvent_seasonId_cursor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OutboxEvent_seasonId_cursor_idx" ON public."OutboxEvent" USING btree ("seasonId", cursor);


--
-- Name: PlayerImportBatch_seasonId_sourceNamespace_sha256_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PlayerImportBatch_seasonId_sourceNamespace_sha256_key" ON public."PlayerImportBatch" USING btree ("seasonId", "sourceNamespace", sha256);


--
-- Name: PlayerPriceAssignment_seasonId_playerId_active_sourceType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PlayerPriceAssignment_seasonId_playerId_active_sourceType_idx" ON public."PlayerPriceAssignment" USING btree ("seasonId", "playerId", active, "sourceType");


--
-- Name: PlayerPriceAssignment_sourceBatchId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PlayerPriceAssignment_sourceBatchId_idx" ON public."PlayerPriceAssignment" USING btree ("sourceBatchId");


--
-- Name: PlayerSourceAlias_playerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PlayerSourceAlias_playerId_idx" ON public."PlayerSourceAlias" USING btree ("playerId");


--
-- Name: PlayerSourceAlias_playerId_sourceNamespace_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PlayerSourceAlias_playerId_sourceNamespace_key" ON public."PlayerSourceAlias" USING btree ("playerId", "sourceNamespace");


--
-- Name: PlayerSourceAlias_seasonId_sourceNamespace_sourceId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PlayerSourceAlias_seasonId_sourceNamespace_sourceId_key" ON public."PlayerSourceAlias" USING btree ("seasonId", "sourceNamespace", "sourceId");


--
-- Name: Player_seasonId_nflTeam_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Player_seasonId_nflTeam_position_idx" ON public."Player" USING btree ("seasonId", "nflTeam", "position");


--
-- Name: Player_seasonId_normalizedSearchText_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Player_seasonId_normalizedSearchText_idx" ON public."Player" USING btree ("seasonId", "normalizedSearchText");


--
-- Name: Player_seasonId_providerActive_leagueSelectable_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Player_seasonId_providerActive_leagueSelectable_idx" ON public."Player" USING btree ("seasonId", "providerActive", "leagueSelectable");


--
-- Name: Player_seasonId_sourceType_sourceNamespace_externalId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Player_seasonId_sourceType_sourceNamespace_externalId_key" ON public."Player" USING btree ("seasonId", "sourceType", "sourceNamespace", "externalId");


--
-- Name: PricePreparationBatch_seasonId_sourceHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PricePreparationBatch_seasonId_sourceHash_key" ON public."PricePreparationBatch" USING btree ("seasonId", "sourceHash");


--
-- Name: PricePreparationBatch_seasonId_state_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PricePreparationBatch_seasonId_state_createdAt_idx" ON public."PricePreparationBatch" USING btree ("seasonId", state, "createdAt");


--
-- Name: PricePreparationRow_batchId_matchKind_disposition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PricePreparationRow_batchId_matchKind_disposition_idx" ON public."PricePreparationRow" USING btree ("batchId", "matchKind", disposition);


--
-- Name: PricePreparationRow_batchId_rowNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PricePreparationRow_batchId_rowNumber_key" ON public."PricePreparationRow" USING btree ("batchId", "rowNumber");


--
-- Name: RosterAssignment_seasonId_playerId_supersededAt_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "RosterAssignment_seasonId_playerId_supersededAt_key" ON public."RosterAssignment" USING btree ("seasonId", "playerId", "supersededAt");


--
-- Name: SeasonTeam_seasonId_seedOrder_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SeasonTeam_seasonId_seedOrder_key" ON public."SeasonTeam" USING btree ("seasonId", "seedOrder");


--
-- Name: SeasonTeam_seasonId_teamId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SeasonTeam_seasonId_teamId_key" ON public."SeasonTeam" USING btree ("seasonId", "teamId");


--
-- Name: Season_leagueId_year_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Season_leagueId_year_key" ON public."Season" USING btree ("leagueId", year);


--
-- Name: TeamAuctionBalance_seasonId_seasonTeamId_roundNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TeamAuctionBalance_seasonId_seasonTeamId_roundNumber_key" ON public."TeamAuctionBalance" USING btree ("seasonId", "seasonTeamId", "roundNumber");


--
-- Name: AuctionAttempt AuctionAttempt_roundId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuctionAttempt"
    ADD CONSTRAINT "AuctionAttempt_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES public."AuctionRound"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AuctionAward AuctionAward_roundId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuctionAward"
    ADD CONSTRAINT "AuctionAward_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES public."AuctionRound"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AuctionRound AuctionRound_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuctionRound"
    ADD CONSTRAINT "AuctionRound_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AuctionSubmission AuctionSubmission_roundId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuctionSubmission"
    ADD CONSTRAINT "AuctionSubmission_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES public."AuctionRound"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AuctionTieDecision AuctionTieDecision_roundId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuctionTieDecision"
    ADD CONSTRAINT "AuctionTieDecision_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES public."AuctionRound"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AuditEvent AuditEvent_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditEvent"
    ADD CONSTRAINT "AuditEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CatalogPreparationBatch CatalogPreparationBatch_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CatalogPreparationBatch"
    ADD CONSTRAINT "CatalogPreparationBatch_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CatalogPreparationRow CatalogPreparationRow_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CatalogPreparationRow"
    ADD CONSTRAINT "CatalogPreparationRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."CatalogPreparationBatch"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CatalogSnapshot CatalogSnapshot_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CatalogSnapshot"
    ADD CONSTRAINT "CatalogSnapshot_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Checkpoint Checkpoint_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checkpoint"
    ADD CONSTRAINT "Checkpoint_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Checkpoint Checkpoint_sourceAuditEventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checkpoint"
    ADD CONSTRAINT "Checkpoint_sourceAuditEventId_fkey" FOREIGN KEY ("sourceAuditEventId") REFERENCES public."AuditEvent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Checkpoint Checkpoint_stateSnapshotId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checkpoint"
    ADD CONSTRAINT "Checkpoint_stateSnapshotId_fkey" FOREIGN KEY ("stateSnapshotId") REFERENCES public."FrozenSnapshot"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CommandReceipt CommandReceipt_auditEventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CommandReceipt"
    ADD CONSTRAINT "CommandReceipt_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES public."AuditEvent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CommandReceipt CommandReceipt_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CommandReceipt"
    ADD CONSTRAINT "CommandReceipt_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ConventionalDraft ConventionalDraft_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ConventionalDraft"
    ADD CONSTRAINT "ConventionalDraft_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CorrectionAction CorrectionAction_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CorrectionAction"
    ADD CONSTRAINT "CorrectionAction_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: DraftOrderEntry DraftOrderEntry_conventionalDraftId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DraftOrderEntry"
    ADD CONSTRAINT "DraftOrderEntry_conventionalDraftId_fkey" FOREIGN KEY ("conventionalDraftId") REFERENCES public."ConventionalDraft"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: DraftOrderEntry DraftOrderEntry_seasonTeamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DraftOrderEntry"
    ADD CONSTRAINT "DraftOrderEntry_seasonTeamId_fkey" FOREIGN KEY ("seasonTeamId") REFERENCES public."SeasonTeam"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: DraftOrderTieDecision DraftOrderTieDecision_conventionalDraftId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DraftOrderTieDecision"
    ADD CONSTRAINT "DraftOrderTieDecision_conventionalDraftId_fkey" FOREIGN KEY ("conventionalDraftId") REFERENCES public."ConventionalDraft"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: DraftPick DraftPick_conventionalDraftId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DraftPick"
    ADD CONSTRAINT "DraftPick_conventionalDraftId_fkey" FOREIGN KEY ("conventionalDraftId") REFERENCES public."ConventionalDraft"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: DraftPick DraftPick_seasonTeamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DraftPick"
    ADD CONSTRAINT "DraftPick_seasonTeamId_fkey" FOREIGN KEY ("seasonTeamId") REFERENCES public."SeasonTeam"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ExportRecord ExportRecord_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExportRecord"
    ADD CONSTRAINT "ExportRecord_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FrozenSnapshot FrozenSnapshot_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FrozenSnapshot"
    ADD CONSTRAINT "FrozenSnapshot_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FrozenSnapshot FrozenSnapshot_sourceAuditEventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FrozenSnapshot"
    ADD CONSTRAINT "FrozenSnapshot_sourceAuditEventId_fkey" FOREIGN KEY ("sourceAuditEventId") REFERENCES public."AuditEvent"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: KeeperSelection KeeperSelection_playerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KeeperSelection"
    ADD CONSTRAINT "KeeperSelection_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES public."Player"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: KeeperSelection KeeperSelection_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KeeperSelection"
    ADD CONSTRAINT "KeeperSelection_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: KeeperSelection KeeperSelection_seasonTeamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KeeperSelection"
    ADD CONSTRAINT "KeeperSelection_seasonTeamId_fkey" FOREIGN KEY ("seasonTeamId") REFERENCES public."SeasonTeam"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OutboxEvent OutboxEvent_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OutboxEvent"
    ADD CONSTRAINT "OutboxEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PlayerImportBatch PlayerImportBatch_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PlayerImportBatch"
    ADD CONSTRAINT "PlayerImportBatch_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PlayerPriceAssignment PlayerPriceAssignment_playerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PlayerPriceAssignment"
    ADD CONSTRAINT "PlayerPriceAssignment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES public."Player"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PlayerPriceAssignment PlayerPriceAssignment_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PlayerPriceAssignment"
    ADD CONSTRAINT "PlayerPriceAssignment_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PlayerPriceAssignment PlayerPriceAssignment_sourceBatchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PlayerPriceAssignment"
    ADD CONSTRAINT "PlayerPriceAssignment_sourceBatchId_fkey" FOREIGN KEY ("sourceBatchId") REFERENCES public."PricePreparationBatch"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PlayerSourceAlias PlayerSourceAlias_playerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PlayerSourceAlias"
    ADD CONSTRAINT "PlayerSourceAlias_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES public."Player"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PlayerSourceAlias PlayerSourceAlias_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PlayerSourceAlias"
    ADD CONSTRAINT "PlayerSourceAlias_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Player Player_catalogSnapshotId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Player"
    ADD CONSTRAINT "Player_catalogSnapshotId_fkey" FOREIGN KEY ("catalogSnapshotId") REFERENCES public."CatalogSnapshot"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Player Player_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Player"
    ADD CONSTRAINT "Player_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PositionPriceFloor PositionPriceFloor_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PositionPriceFloor"
    ADD CONSTRAINT "PositionPriceFloor_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PricePreparationBatch PricePreparationBatch_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PricePreparationBatch"
    ADD CONSTRAINT "PricePreparationBatch_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PricePreparationRow PricePreparationRow_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PricePreparationRow"
    ADD CONSTRAINT "PricePreparationRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."PricePreparationBatch"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SeasonTeam SeasonTeam_seasonId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SeasonTeam"
    ADD CONSTRAINT "SeasonTeam_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES public."Season"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SeasonTeam SeasonTeam_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SeasonTeam"
    ADD CONSTRAINT "SeasonTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Season Season_leagueId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Season"
    ADD CONSTRAINT "Season_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES public."League"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Team Team_leagueId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Team"
    ADD CONSTRAINT "Team_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES public."League"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete

-- PostgreSQL treats NULL values as distinct in ordinary unique constraints.
-- These partial indexes preserve the accepted active/superseded lineage rules.
ALTER TABLE public."FrozenSnapshot"
  ALTER CONSTRAINT "FrozenSnapshot_sourceAuditEventId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."Checkpoint"
  ALTER CONSTRAINT "Checkpoint_sourceAuditEventId_fkey" DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX "DraftOrderEntry_active_position_key"
  ON public."DraftOrderEntry" ("conventionalDraftId", "orderPosition")
  WHERE "supersededAt" IS NULL;
CREATE UNIQUE INDEX "DraftOrderEntry_active_team_key"
  ON public."DraftOrderEntry" ("conventionalDraftId", "seasonTeamId")
  WHERE "supersededAt" IS NULL;
CREATE UNIQUE INDEX "DraftOrderTieDecision_active_balance_key"
  ON public."DraftOrderTieDecision" ("conventionalDraftId", balance)
  WHERE "supersededAt" IS NULL;
CREATE UNIQUE INDEX "DraftPick_active_overall_key"
  ON public."DraftPick" ("conventionalDraftId", "overallPick")
  WHERE active = true;
CREATE UNIQUE INDEX "DraftPick_active_player_key"
  ON public."DraftPick" ("conventionalDraftId", "playerId")
  WHERE active = true;
CREATE UNIQUE INDEX "PositionPriceFloor_active_position_key"
  ON public."PositionPriceFloor" ("seasonId", position)
  WHERE "supersededAt" IS NULL;
CREATE UNIQUE INDEX "RosterAssignment_active_player_key"
  ON public."RosterAssignment" ("seasonId", "playerId")
  WHERE "supersededAt" IS NULL;
CREATE UNIQUE INDEX "AuctionRound_active_round_key"
  ON public."AuctionRound" ("seasonId", "roundNumber")
  WHERE "supersededAt" IS NULL;

-- Accepted audit history is append-only in both persistence profiles.
CREATE FUNCTION public.reject_audit_event_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$;
CREATE TRIGGER "AuditEvent_no_update"
  BEFORE UPDATE ON public."AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_event_mutation();
CREATE TRIGGER "AuditEvent_no_delete"
  BEFORE DELETE ON public."AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_event_mutation();
--
