export enum LifecycleState {
  SETUP = "SETUP",
  KEEPERS_LOCKED = "KEEPERS_LOCKED",
  R1_BIDDING = "R1_BIDDING",
  R1_TIE_PAUSED = "R1_TIE_PAUSED",
  R1_REVIEW = "R1_REVIEW",
  R1_PUBLISHED = "R1_PUBLISHED",
  R2_BIDDING = "R2_BIDDING",
  R2_TIE_PAUSED = "R2_TIE_PAUSED",
  R2_REVIEW = "R2_REVIEW",
  R2_PUBLISHED = "R2_PUBLISHED",
  ORDER_TIE_PAUSED = "ORDER_TIE_PAUSED",
  ORDER_FINAL = "ORDER_FINAL",
  CONVENTIONAL_DRAFT = "CONVENTIONAL_DRAFT",
  COMPLETED = "COMPLETED",
}

export interface ActorDescriptor { readonly type: string; readonly label: string }
export interface CommandMetadata {
  readonly actor: ActorDescriptor;
  readonly seasonId: string;
  readonly idempotencyKey: string;
  readonly commandType: string;
  readonly expectedVersion?: number;
  readonly correlationId?: string;
  readonly reason?: string;
}
export interface SeasonRecord { id: string; leagueId: string; year: number; name: string; state: LifecycleState; teamCount: number; rowVersion: number; active: boolean }
export interface SnapshotRecord { id: string; seasonId: string; kind: string; schemaVersion: number; payloadJson: string; sha256: string; sourceAuditEventId: string }
export interface CheckpointRecord { id: string; seasonId: string; kind: string; seasonVersion: number; stateSnapshotId: string; sourceAuditEventId: string }

export interface SeasonTransaction {
  createSeason(input: Omit<SeasonRecord, "state" | "rowVersion" | "active">): Promise<SeasonRecord>;
  transition(seasonId: string, expectedVersion: number, target: LifecycleState): Promise<SeasonRecord>;
  addSnapshot(input: Omit<SnapshotRecord, "sourceAuditEventId">): Promise<SnapshotRecord>;
  addCheckpoint(input: Omit<CheckpointRecord, "sourceAuditEventId">): Promise<CheckpointRecord>;
}

export interface SeasonRepository {
  execute<T>(metadata: CommandMetadata, operation: (transaction: SeasonTransaction) => T | Promise<T>): Promise<T>;
  getSeason(actor: ActorDescriptor, seasonId: string): Promise<SeasonRecord | undefined>;
  listSeasons(actor: ActorDescriptor): Promise<SeasonRecord[]>;
}
