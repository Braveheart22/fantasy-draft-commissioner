export const DEFAULT_ROSTER_RULES = Object.freeze({
  limits: Object.freeze({ QB: 2, RB: 2, WR: 3, TE: 2, K: 2, DST: 2 }),
  flexEligible: Object.freeze(["RB", "WR", "TE"]),
  flexCapacity: 1,
});

/** Pure partial-roster capacity validation; no permanent FLEX slot assignment. */
export function validateRosterCapacity(positions, rules = DEFAULT_ROSTER_RULES) {
  if (!Array.isArray(positions) || !rules || typeof rules !== "object" || !rules.limits || typeof rules.limits !== "object" ||
      !Array.isArray(rules.flexEligible) || !Number.isSafeInteger(rules.flexCapacity) || rules.flexCapacity < 0) {
    return { legal: false, reason: "INVALID_ROSTER_RULES" };
  }
  const counts = Object.fromEntries(Object.keys(rules.limits).map((p) => [p, 0]));
  for (const position of positions) {
    if (!Object.hasOwn(rules.limits, position)) {
      return { legal: false, reason: "UNKNOWN_POSITION", position };
    }
    counts[position] += 1;
  }

  let flexUsed = 0;
  for (const [position, count] of Object.entries(counts)) {
    const overflow = Math.max(0, count - rules.limits[position]);
    if (overflow && !rules.flexEligible.includes(position)) {
      return { legal: false, reason: "ROSTER_CAPACITY_EXCEEDED", position, counts, flexUsed };
    }
    flexUsed += overflow;
  }
  if (flexUsed > rules.flexCapacity) {
    return { legal: false, reason: "ROSTER_CAPACITY_EXCEEDED", counts, flexUsed };
  }
  return { legal: true, counts, flexUsed };
}

export function canAddPlayer(positions, position, rules = DEFAULT_ROSTER_RULES) {
  return validateRosterCapacity([...positions, position], rules);
}
