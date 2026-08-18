import type {
  AuctionEnginePort,
  AuctionEngineResult,
  CommissionerAuctionInput,
  EngineAuctionInput,
} from "../application/ports/auction-engine.js";

// Phase 1 intentionally remains JavaScript and is the immutable public boundary.
// @ts-expect-error The accepted Phase 1 package has no declaration file.
import { resolveAuction } from "../../../../src/index.js";

export class AuctionMappingError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid commissioner auction mapping: ${problems.join("; ")}`);
    this.name = "AuctionMappingError";
    this.problems = problems;
  }
}

export function toEngineInput(input: CommissionerAuctionInput): EngineAuctionInput {
  const problems: string[] = [];
  const positions = input.rosterRules.positionLimits;

  for (const player of input.players) {
    if (!Object.hasOwn(positions, player.position)) problems.push(`unknown position for player ${player.playerId}`);
    if (!Number.isSafeInteger(player.minimumBid) || player.minimumBid < 1) problems.push(`invalid minimum bid for player ${player.playerId}`);
  }
  for (const team of input.teams) {
    if (!Number.isSafeInteger(team.startingBudget) || team.startingBudget < 0) problems.push(`invalid starting budget for team ${team.teamId}`);
  }
  if (problems.length > 0) throw new AuctionMappingError(problems);

  return {
    teams: input.teams.map((team) => ({
      id: team.teamId,
      budget: team.startingBudget,
      roster: [...team.startingPlayerIds],
    })),
    players: input.players.map((player) => ({
      id: player.playerId,
      position: player.position,
      minimumBid: player.minimumBid,
      ...(player.available === undefined ? {} : { available: player.available }),
    })),
    bids: input.bids.map((bid) => ({
      id: bid.bidId,
      teamId: bid.teamId,
      priority: bid.priority,
      playerId: bid.playerId,
      amount: bid.amount,
    })),
    rosterRules: {
      limits: { ...input.rosterRules.positionLimits },
      flexEligible: [...input.rosterRules.flexEligiblePositions],
      flexCapacity: input.rosterRules.flexCapacity,
    },
    tieDecisions: input.tiePrecedence.map((decision) => ({
      playerId: decision.playerId,
      amount: decision.amount,
      teamIds: [...decision.participantTeamIds],
      preferredTeamId: decision.preferredTeamId,
    })),
  };
}

export function resolveAuctionThroughAdapter(input: CommissionerAuctionInput): AuctionEngineResult {
  return resolveAuction(toEngineInput(input)) as AuctionEngineResult;
}

export const auctionEngineAdapter: AuctionEnginePort = {
  resolve: resolveAuctionThroughAdapter,
};
