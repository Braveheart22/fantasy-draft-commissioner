# Phase 1 implementation report

## Outcome

Phase 1 is implemented as a dependency-free, pure JavaScript domain package.
It includes the partial-roster capacity validator, deterministic auction
allocator, validation, provisional high-bid selection, owner-priority pruning,
simultaneous immutable elimination passes, fallback, external tie precedence,
and a complete resolution trace.

No UI, database, authentication, live draft, ESPN, or realtime work was added.

## Verification

- Command: `node --test`
- Result: 35 passed, 0 failed, 0 skipped
- Approved golden/adversarial scenarios 1–31: all pass
- Generated property auctions: 300
- Budget, unique award, roster legality, bid-dollar identity, active-dollar
  precedence, monotonic elimination, order independence, input purity, and
  deterministic replay checks: pass
- Supplied-tie precedence order independence and deterministic replay: pass

The normal `npm test` launcher could not run on this host because its globally
installed npm entry point references a missing `npm-cli.js`. The identical test
script was run directly with Node's built-in runner.

## Review finding resolved

The initial implementation incorrectly allowed every owner in an unresolved tie
to conditionally spend the tied amount and permanently prune lower-priority
bids. The corrected engine uses already-preserved higher priorities to reject an
unaffordable tied bid, but a viable unresolved tie becomes a conditional stop:
lower priorities remain active and unawarded until external precedence is
supplied. Regression tests cover this boundary.

Input validation, hostile identifier handling, roster-rule validation,
tie-decision backing, collision-safe tie keys, and shrinking-tie precedence were
also hardened during review.

## Deviations and unresolved items

- No design deviation from the approved allocation convention.
- No failed or ambiguous approved scenario remains.
- No contradiction was found in the approved rules.
- Mutation testing is configured with Stryker but was not executed because npm
  is broken and development dependencies are not installed in this workspace.
  No mutation score is claimed.
