import { LifecycleState } from "../ports/season-repository.js";

const forward: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  SETUP: [LifecycleState.KEEPERS_LOCKED],
  KEEPERS_LOCKED: [LifecycleState.R1_BIDDING, LifecycleState.SETUP],
  R1_BIDDING: [LifecycleState.R1_TIE_PAUSED, LifecycleState.R1_REVIEW],
  R1_TIE_PAUSED: [LifecycleState.R1_REVIEW],
  R1_REVIEW: [LifecycleState.R1_PUBLISHED, LifecycleState.R1_BIDDING],
  R1_PUBLISHED: [LifecycleState.R2_BIDDING, LifecycleState.KEEPERS_LOCKED],
  R2_BIDDING: [LifecycleState.R2_TIE_PAUSED, LifecycleState.R2_REVIEW],
  R2_TIE_PAUSED: [LifecycleState.R2_REVIEW],
  R2_REVIEW: [LifecycleState.R2_PUBLISHED],
  R2_PUBLISHED: [LifecycleState.ORDER_TIE_PAUSED, LifecycleState.ORDER_FINAL, LifecycleState.R1_PUBLISHED],
  ORDER_TIE_PAUSED: [LifecycleState.ORDER_FINAL],
  ORDER_FINAL: [LifecycleState.CONVENTIONAL_DRAFT],
  CONVENTIONAL_DRAFT: [LifecycleState.CONVENTIONAL_DRAFT, LifecycleState.COMPLETED, LifecycleState.R2_PUBLISHED],
  COMPLETED: [],
};

export function assertLifecycleTransition(from: LifecycleState, to: LifecycleState): void {
  if (!forward[from].includes(to)) throw new Error(`Illegal lifecycle transition: ${from} -> ${to}`);
}
