# Fantasy auction engine — Phase 1

This package contains only the pure roster-capacity validator and deterministic
auction allocator. It has no UI, persistence, authentication, live-draft,
ESPN, or realtime dependencies.

The allocator implements **Provisional High-Bid / Priority-Pruning** as the
application's deterministic convention for resolving dependency cycles and
ambiguous simultaneous interactions. This name describes the application's
formal resolution convention; it does not claim the league historically used
algorithmic terminology.

For each pass, every player's highest-dollar active bid is provisional. Each
owner evaluates only their own provisional opportunities in Priority 1→2→3
order. Unaffordable or roster-illegal bids are collected from one immutable
snapshot, eliminated simultaneously, and never reactivated. Resolution repeats
until stable.

Equal-dollar leaders are provisional opportunities for viability pruning. If
multiple viable leaders remain, the result reports a tie. A supplied decision
only gives precedence within the exact recorded participant set; it never
overrides budget or roster legality. If its preferred bidder is eliminated, a
smaller remaining tied set needs its own decision.

An unresolved tied opportunity can be rejected using already-preserved,
higher-priority awards. If it remains viable, it is marked conditional and the
owner's lower priorities are left active and unawarded until precedence is
supplied; they are never permanently pruned based on an outcome not yet known.

Run `npm test`. Mutation testing is configured with Stryker; after installing
development dependencies, run `npm run test:mutation`.

## Public input

`resolveAuction({ teams, players, bids, tieDecisions?, rosterRules? })`

- team: `{ id, budget, roster?: [playerId] }`
- player: `{ id, position, minimumBid, available?: boolean }`
- bid: `{ id, teamId, playerId, priority, amount }`
- tie decision: `{ playerId, amount, teamIds, preferredTeamId }`

Malformed domain structure throws `AuctionInputError`. Legitimate bids that can
never win are returned in `eliminations` with an explicit reason.
