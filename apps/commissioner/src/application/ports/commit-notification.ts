import type { ActorDescriptor } from "./actor.js";

export interface CommitNotification {
  readonly actor: ActorDescriptor;
  readonly seasonId: string;
  readonly seasonVersion?: number;
  readonly commandType: string;
  readonly correlationId: string;
}

export interface CommitNotificationPort {
  /** Best-effort local observation after commit; durable hosted delivery is transaction-owned. */
  committed(notification: CommitNotification): void | Promise<void>;
}

export class NoOpCommitNotification implements CommitNotificationPort {
  committed(_notification: CommitNotification): void {}
}
