export const p = (id, position = "RB", minimumBid = 1) => ({ id, position, minimumBid });
export const t = (id, budget = 350, roster = []) => ({ id, budget, roster });
export const b = (teamId, priority, playerId, amount) => ({ id: `${teamId}-${priority}-${playerId}`, teamId, priority, playerId, amount });
export const awards = (result) => Object.fromEntries(result.awards.map((a) => [a.playerId, `${a.teamId}:${a.amount}`]));
export const input = (teams, players, bids, tieDecisions = []) => ({ teams, players, bids, tieDecisions });
