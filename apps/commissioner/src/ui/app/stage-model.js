export const stages = [
  ["SETUP", "Setup"], ["KEEPERS", "Keepers"], ["AUCTION_1", "Auction 1"],
  ["AUCTION_2", "Auction 2"], ["DRAFT_ORDER", "Draft Order"], ["DRAFT", "Draft"], ["RESULTS", "Results"],
];

export function stageAccess(legalStage, requestedStage) {
  const legal = stages.findIndex(([id]) => id === legalStage);
  const requested = stages.findIndex(([id]) => id === requestedStage);
  if (requested > legal) return { stage: legalStage, mode: "CURRENT", explanation: `${stages[requested][1]} is not available until ${stages[legal][1]} is complete.` };
  if (requested < legal) return { stage: requestedStage, mode: "READ_ONLY", explanation: `${stages[requested][1]} is complete and remains available for review. Open Operations to preview an audited correction.` };
  return { stage: requestedStage, mode: "CURRENT" };
}

export function requestedStageFromHash(hash, fallback) {
  const requested = hash.replace(/^#\/?/, "").replace(/^stage\//, "").toUpperCase();
  return stages.some(([id]) => id === requested) ? requested : fallback;
}

export function stageViewPolicy(access) {
  return { mutationsEnabled: access.mode === "CURRENT", operationsCorrectionOnly: access.mode === "READ_ONLY" };
}
