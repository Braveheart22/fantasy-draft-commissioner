import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RosterRules } from "../application/conventional-draft/conventional-draft-repository.js";

const developmentEngine = new URL("../../../../src/index.js", import.meta.url);
const productionEngine = new URL("../../../../../src/index.js", import.meta.url);
const module = await import((existsSync(fileURLToPath(developmentEngine)) ? developmentEngine : productionEngine).href) as {
  canAddPlayer: (positions: string[], position: string, rules: RosterRules) => { legal: boolean; reason?: string };
  validateRosterCapacity: (positions: string[], rules: RosterRules) => { legal: boolean; reason?: string };
};

export const canAddPlayerThroughPhase1 = module.canAddPlayer;
export const validateRosterThroughPhase1 = module.validateRosterCapacity;
