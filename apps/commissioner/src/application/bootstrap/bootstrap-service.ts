import { LifecycleState, type ActorDescriptor } from "../ports/season-repository.js";
import type { BootstrapRepository, BootstrapSnapshot, Stage } from "./bootstrap-repository.js";

export function deriveLegalStage(state: LifecycleState, setupReady: boolean): Stage {
  if (state === LifecycleState.SETUP) return setupReady ? "KEEPERS" : "SETUP";
  if ([LifecycleState.KEEPERS_LOCKED, LifecycleState.R1_BIDDING, LifecycleState.R1_TIE_PAUSED, LifecycleState.R1_REVIEW].includes(state)) return "AUCTION_1";
  if ([LifecycleState.R1_PUBLISHED, LifecycleState.R2_BIDDING, LifecycleState.R2_TIE_PAUSED, LifecycleState.R2_REVIEW].includes(state)) return "AUCTION_2";
  if ([LifecycleState.R2_PUBLISHED, LifecycleState.ORDER_TIE_PAUSED].includes(state)) return "DRAFT_ORDER";
  if ([LifecycleState.ORDER_FINAL, LifecycleState.CONVENTIONAL_DRAFT].includes(state)) return "DRAFT";
  return "RESULTS";
}

export class BootstrapService {
  constructor(private readonly repository: BootstrapRepository) {}

  async load(actor: ActorDescriptor, seasonId: string): Promise<BootstrapSnapshot> {
    const snapshot = await this.repository.readBootstrap(actor, seasonId);
    return {
      ...snapshot,
      legalStage: deriveLegalStage(snapshot.season.state, snapshot.readiness.setupReady),
      readiness: { ...snapshot.readiness, keepersLocked: snapshot.season.state !== LifecycleState.SETUP },
    };
  }
}
