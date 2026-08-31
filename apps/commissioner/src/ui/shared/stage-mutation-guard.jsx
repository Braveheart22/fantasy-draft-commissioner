import { useEffect, useRef } from "react";

// Link navigation and browser hash/history navigation must both keep a pending
// or acknowledged-but-unhydrated mutation mounted until recovery finishes.
export function installStageMutationGuard(target, stage, isBlocked) {
  const guard = event => {
    if (isBlocked() && !event.detail?.canonical && event.detail?.stage !== stage) event.preventDefault();
  };
  target.addEventListener("stage-navigation-request", guard);
  target.addEventListener("stage-route-change", guard);
  return () => {
    target.removeEventListener("stage-navigation-request", guard);
    target.removeEventListener("stage-route-change", guard);
  };
}

export function guardedStageRoute(target, next, current, legalStage, restore) {
  const event = new CustomEvent("stage-route-change", { cancelable: true, detail: { stage: next, canonical: next === legalStage } });
  if (!target.dispatchEvent(event)) { restore(current); return current; }
  return next;
}

export function useStageMutationGuard(stage, blocked) {
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  useEffect(() => installStageMutationGuard(window, stage, () => blockedRef.current), [stage]);
}
