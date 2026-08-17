import { DEFAULT_ROSTER_RULES, canAddPlayer, validateRosterCapacity } from "./roster.js";

export const EliminationReason = Object.freeze({
  BELOW_MINIMUM: "BELOW_MINIMUM",
  BID_EXCEEDS_STARTING_BUDGET: "BID_EXCEEDS_STARTING_BUDGET",
  PLAYER_UNAVAILABLE: "PLAYER_UNAVAILABLE",
  ROSTER_CAPACITY_EXCEEDED: "ROSTER_CAPACITY_EXCEEDED",
  INSUFFICIENT_REMAINING_BUDGET: "INSUFFICIENT_REMAINING_BUDGET",
});

export class AuctionInputError extends Error {
  constructor(errors) {
    super(`Invalid auction input: ${errors.join("; ")}`);
    this.name = "AuctionInputError";
    this.errors = errors;
  }
}

const byId = (a, b) => a.id.localeCompare(b.id);
const canonicalIds = (ids) => [...ids].sort((a, b) => a.localeCompare(b));
const tieKey = (playerId, amount, teamIds) => JSON.stringify([playerId, amount, canonicalIds(teamIds)]);

function validRules(rules) {
  if (!rules || typeof rules !== "object" || !rules.limits || typeof rules.limits !== "object" || Array.isArray(rules.limits) ||
      !Array.isArray(rules.flexEligible) || !Number.isSafeInteger(rules.flexCapacity) || rules.flexCapacity < 0) return false;
  const positions = Object.keys(rules.limits);
  return positions.length > 0 && positions.every((position) => typeof position === "string" && position.length > 0 &&
    Number.isSafeInteger(rules.limits[position]) && rules.limits[position] >= 0) &&
    new Set(rules.flexEligible).size === rules.flexEligible.length &&
    rules.flexEligible.every((position) => typeof position === "string" && Object.hasOwn(rules.limits, position));
}

function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== "object") throw new AuctionInputError(["input must be an object"]);
  const teams = Array.isArray(input.teams) ? input.teams : [];
  const players = Array.isArray(input.players) ? input.players : [];
  const bids = Array.isArray(input.bids) ? input.bids : [];
  if (!Array.isArray(input.teams)) errors.push("teams must be an array");
  if (!Array.isArray(input.players)) errors.push("players must be an array");
  if (!Array.isArray(input.bids)) errors.push("bids must be an array");
  if (input.tieDecisions !== undefined && !Array.isArray(input.tieDecisions)) errors.push("tieDecisions must be an array");
  const rules = input?.rosterRules ?? DEFAULT_ROSTER_RULES;
  if (!validRules(rules)) errors.push("invalid roster rules");
  const teamIds = new Set();
  const playerIds = new Set();
  const bidIds = new Set();
  const priorities = new Set();
  const teamPlayers = new Set();
  const rostered = new Set();

  for (const team of teams) {
    if (!team || typeof team !== "object") {
      errors.push("team entries must be objects");
      continue;
    }
    if (typeof team?.id !== "string" || !team.id || teamIds.has(team.id)) errors.push(`duplicate or missing team id: ${team?.id}`);
    teamIds.add(team?.id);
    if (!Number.isSafeInteger(team?.budget) || team.budget < 0) errors.push(`invalid budget for team ${team?.id}`);
    if (team?.roster !== undefined && !Array.isArray(team.roster)) errors.push(`invalid roster for team ${team?.id}`);
  }
  for (const player of players) {
    if (!player || typeof player !== "object") {
      errors.push("player entries must be objects");
      continue;
    }
    if (typeof player?.id !== "string" || !player.id || playerIds.has(player.id)) errors.push(`duplicate or missing player id: ${player?.id}`);
    playerIds.add(player?.id);
    if (typeof player?.position !== "string" || !Object.hasOwn(rules?.limits ?? {}, player.position)) errors.push(`unknown position for player ${player?.id}`);
    if (!Number.isSafeInteger(player?.minimumBid) || player.minimumBid < 1) errors.push(`invalid minimum bid for player ${player?.id}`);
  }
  for (const team of teams) {
    if (!team || typeof team !== "object" || !Array.isArray(team.roster ?? [])) continue;
    const positions = [];
    for (const id of team.roster ?? []) {
      const player = players.find((p) => p.id === id);
      if (!player) errors.push(`unknown roster player ${id} for team ${team.id}`);
      else positions.push(player.position);
      if (rostered.has(id)) errors.push(`player ${id} appears on multiple starting rosters`);
      rostered.add(id);
    }
    if (positions.length && !validateRosterCapacity(positions, rules).legal) errors.push(`illegal starting roster for team ${team.id}`);
  }
  for (const bid of bids) {
    if (!bid || typeof bid !== "object") {
      errors.push("bid entries must be objects");
      continue;
    }
    if (typeof bid?.id !== "string" || !bid.id || bidIds.has(bid.id)) errors.push(`duplicate or missing bid id: ${bid?.id}`);
    bidIds.add(bid?.id);
    if (!teamIds.has(bid.teamId)) errors.push(`unknown team on bid ${bid.id}`);
    if (!playerIds.has(bid.playerId)) errors.push(`unknown player on bid ${bid.id}`);
    if (![1, 2, 3].includes(bid.priority)) errors.push(`invalid priority on bid ${bid.id}`);
    if (!Number.isSafeInteger(bid.amount) || bid.amount < 0) errors.push(`invalid amount on bid ${bid.id}`);
    const priorityKey = `${bid.teamId}|${bid.priority}`;
    if (priorities.has(priorityKey)) errors.push(`duplicate priority ${bid.priority} for team ${bid.teamId}`);
    priorities.add(priorityKey);
    const teamPlayerKey = `${bid.teamId}|${bid.playerId}`;
    if (teamPlayers.has(teamPlayerKey)) errors.push(`duplicate player bid by team ${bid.teamId}`);
    teamPlayers.add(teamPlayerKey);
  }
  if (bids.length > teams.length * 3) errors.push("more than three bids for at least one team");
  for (const team of teams) {
    if (!team || typeof team !== "object") continue;
    if (bids.filter((b) => b?.teamId === team.id).length > 3) errors.push(`more than three bids for team ${team.id}`);
  }

  const decisionKeys = new Set();
  for (const d of Array.isArray(input.tieDecisions) ? input.tieDecisions : []) {
    if (!d || typeof d !== "object") {
      errors.push("tie decision entries must be objects");
      continue;
    }
    const ids = canonicalIds(Array.isArray(d.teamIds) ? d.teamIds : []);
    const key = tieKey(d.playerId, d.amount, ids);
    const backed = ids.every((teamId) => teamIds.has(teamId) && bids.some((bid) => bid?.teamId === teamId && bid.playerId === d.playerId && bid.amount === d.amount));
    if (!playerIds.has(d.playerId) || !Number.isSafeInteger(d.amount) || ids.length < 2 || !ids.includes(d.preferredTeamId) || !backed) {
      errors.push(`invalid tie decision ${key}`);
    }
    if (new Set(ids).size !== ids.length || decisionKeys.has(key)) errors.push(`duplicate/invalid tie decision ${key}`);
    decisionKeys.add(key);
  }
  if (errors.length) throw new AuctionInputError(errors);
  return { rules, rostered, teams, players, bids };
}

function selectProvisional(groups, active, decisions) {
  const opportunities = [];
  const tieStates = [];
  for (const [playerId, bids] of groups) {
    const candidates = bids.filter((b) => active.has(b.id));
    if (!candidates.length) continue;
    const amount = candidates[0].amount;
    const leaders = candidates.filter((b) => b.amount === amount);
    if (leaders.length === 1) opportunities.push(leaders[0]);
    else {
      const ids = canonicalIds(leaders.map((b) => b.teamId));
      const key = tieKey(playerId, amount, ids);
      const decision = decisions.get(key) ?? [...decisions.values()].find((d) =>
        d.playerId === playerId && d.amount === amount && leaders.every((leader) => d.teamIds.includes(leader.teamId)) &&
        leaders.some((leader) => leader.teamId === d.preferredTeamId));
      if (decision) opportunities.push(leaders.find((b) => b.teamId === decision.preferredTeamId));
      else {
        opportunities.push(...leaders);
        tieStates.push({ key, playerId, amount, teamIds: ids });
      }
    }
  }
  return { opportunities, tieStates };
}

export function resolveAuction(input) {
  const validated = validateInput(input);
  const { rules, rostered } = validated;
  const teams = [...validated.teams].sort(byId);
  const players = [...validated.players].sort(byId);
  const bids = [...validated.bids].sort((a, b) => b.amount - a.amount || a.teamId.localeCompare(b.teamId) || a.id.localeCompare(b.id));
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const groups = new Map(players.map((p) => [p.id, bids.filter((b) => b.playerId === p.id)]));
  const decisions = new Map((input.tieDecisions ?? []).map((d) => [tieKey(d.playerId, d.amount, d.teamIds), d]));
  const active = new Set(bids.map((b) => b.id));
  const eliminations = [];
  const trace = [];

  const eliminate = (bid, reason, iteration, details = {}) => {
    if (!active.delete(bid.id)) return;
    eliminations.push({ bidId: bid.id, teamId: bid.teamId, playerId: bid.playerId, reason, iteration, ...details });
  };

  for (const bid of bids) {
    const team = teamMap.get(bid.teamId);
    const player = playerMap.get(bid.playerId);
    if (bid.amount < player.minimumBid) eliminate(bid, EliminationReason.BELOW_MINIMUM, 0);
    else if (bid.amount > team.budget) eliminate(bid, EliminationReason.BID_EXCEEDS_STARTING_BUDGET, 0);
    else if (player.available === false || rostered.has(player.id)) eliminate(bid, EliminationReason.PLAYER_UNAVAILABLE, 0);
    else {
      const startingPositions = (team.roster ?? []).map((id) => playerMap.get(id).position);
      if (!canAddPlayer(startingPositions, player.position, rules).legal) eliminate(bid, EliminationReason.ROSTER_CAPACITY_EXCEEDED, 0);
    }
  }
  if (eliminations.length) trace.push({ iteration: 0, type: "INITIAL_ELIMINATIONS", eliminations: eliminations.map((e) => ({ ...e })) });

  let iteration = 1;
  while (true) {
    const snapshot = selectProvisional(groups, active, decisions);
    const unresolvedBidIds = new Set(snapshot.tieStates.flatMap((tie) => tie.teamIds.map((teamId) =>
      snapshot.opportunities.find((bid) => bid.playerId === tie.playerId && bid.teamId === teamId)?.id).filter(Boolean)));
    const pending = [];
    const ownerEvaluations = [];
    for (const team of teams) {
      const owned = snapshot.opportunities
        .filter((b) => b.teamId === team.id)
        .sort((a, b) => a.priority - b.priority || a.playerId.localeCompare(b.playerId));
      let remainingBudget = team.budget;
      const positions = (team.roster ?? []).map((id) => playerMap.get(id).position);
      const evaluations = [];
      for (const bid of owned) {
        const player = playerMap.get(bid.playerId);
        if (remainingBudget < bid.amount) {
          pending.push({ bid, reason: EliminationReason.INSUFFICIENT_REMAINING_BUDGET, remainingBudget });
          evaluations.push({ bidId: bid.id, action: "ELIMINATE", reason: EliminationReason.INSUFFICIENT_REMAINING_BUDGET, remainingBudget });
        } else {
          const capacity = canAddPlayer(positions, player.position, rules);
          if (!capacity.legal) {
            pending.push({ bid, reason: EliminationReason.ROSTER_CAPACITY_EXCEEDED, remainingBudget });
            evaluations.push({ bidId: bid.id, action: "ELIMINATE", reason: EliminationReason.ROSTER_CAPACITY_EXCEEDED, remainingBudget });
          } else {
            if (unresolvedBidIds.has(bid.id)) {
              evaluations.push({ bidId: bid.id, action: "CONDITIONAL_PRESERVE", remainingBudget });
              break;
            }
            remainingBudget -= bid.amount;
            positions.push(player.position);
            evaluations.push({ bidId: bid.id, action: "PRESERVE", remainingBudget });
          }
        }
      }
      if (evaluations.length) ownerEvaluations.push({ teamId: team.id, evaluations });
    }
    trace.push({
      iteration,
      type: "PROVISIONAL_PASS",
      provisionalBidIds: snapshot.opportunities.map((b) => b.id).sort(),
      ties: snapshot.tieStates,
      ownerEvaluations,
      eliminatedBidIds: pending.map((p) => p.bid.id).sort(),
    });
    if (!pending.length) break;
    for (const item of pending.sort((a, b) => a.bid.id.localeCompare(b.bid.id))) {
      eliminate(item.bid, item.reason, iteration, { remainingBudget: item.remainingBudget });
    }
    iteration += 1;
  }

  const stable = selectProvisional(groups, active, decisions);
  const unresolvedTies = stable.tieStates;
  const tiedKeys = new Set(unresolvedTies.flatMap((t) => t.teamIds.map((teamId) => `${t.playerId}|${teamId}`)));
  const finalPreservedBidIds = new Set(trace.at(-1).ownerEvaluations.flatMap((owner) =>
    owner.evaluations.filter((evaluation) => evaluation.action === "PRESERVE").map((evaluation) => evaluation.bidId)));
  const awards = stable.opportunities
    .filter((b) => !tiedKeys.has(`${b.playerId}|${b.teamId}`) && finalPreservedBidIds.has(b.id))
    .map((b) => ({ playerId: b.playerId, teamId: b.teamId, amount: b.amount, bidId: b.id }))
    .sort((a, b) => a.playerId.localeCompare(b.playerId));
  const teamResults = teams.map((team) => {
    const won = awards.filter((a) => a.teamId === team.id);
    const spent = won.reduce((sum, a) => sum + a.amount, 0);
    return { teamId: team.id, spent, remainingBudget: team.budget - spent, playerIds: won.map((a) => a.playerId).sort() };
  });
  return {
    status: unresolvedTies.length ? "UNRESOLVED_TIE" : "RESOLVED",
    awards,
    teamResults,
    unresolvedTies,
    eliminations: eliminations.sort((a, b) => a.iteration - b.iteration || a.bidId.localeCompare(b.bidId)),
    activeBidIds: [...active].sort(),
    trace,
  };
}
