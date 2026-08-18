export type AuctionPriority = 1 | 2 | 3;

export interface CommissionerAuctionInput {
  teams: Array<{
    teamId: string;
    startingBudget: number;
    startingPlayerIds: string[];
  }>;
  players: Array<{
    playerId: string;
    position: string;
    minimumBid: number;
    available?: boolean;
  }>;
  bids: Array<{
    bidId: string;
    teamId: string;
    priority: AuctionPriority;
    playerId: string;
    amount: number;
  }>;
  rosterRules: {
    positionLimits: Record<string, number>;
    flexEligiblePositions: string[];
    flexCapacity: number;
  };
  tiePrecedence: Array<{
    playerId: string;
    amount: number;
    participantTeamIds: string[];
    preferredTeamId: string;
  }>;
}

export interface EngineAuctionInput {
  teams: Array<{ id: string; budget: number; roster: string[] }>;
  players: Array<{ id: string; position: string; minimumBid: number; available?: boolean }>;
  bids: Array<{ id: string; teamId: string; priority: AuctionPriority; playerId: string; amount: number }>;
  rosterRules: { limits: Record<string, number>; flexEligible: string[]; flexCapacity: number };
  tieDecisions: Array<{ playerId: string; amount: number; teamIds: string[]; preferredTeamId: string }>;
}

export interface AuctionEngineResult {
  status: "RESOLVED" | "UNRESOLVED_TIE";
  awards: Array<{ playerId: string; teamId: string; amount: number; bidId: string }>;
  teamResults: Array<{ teamId: string; spent: number; remainingBudget: number; playerIds: string[] }>;
  unresolvedTies: Array<{ key: string; playerId: string; amount: number; teamIds: string[] }>;
  eliminations: Array<Record<string, unknown>>;
  activeBidIds: string[];
  trace: Array<Record<string, unknown>>;
}

export interface AuctionEnginePort {
  resolve(input: CommissionerAuctionInput): AuctionEngineResult;
}
