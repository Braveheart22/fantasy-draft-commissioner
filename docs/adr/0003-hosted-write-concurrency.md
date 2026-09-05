# ADR 0003: Hosted write concurrency

- Status: Accepted
- Date: 2026-09-05
- Scope: Phase 3 U1

## Context

The SQLite adapter serializes all writes through one in-process queue and uses
the season row version for optimistic concurrency. Applying that same guard to
independent owner bid drafts would make one owner's save stale merely because a
different owner saved first.

## Decision

Auction submissions receive a monotonic `submissionVersion`. Save/finalize and
commissioner pre-lock edits compare the expected submission version and update
that submission atomically. Every successful command also increments the
canonical season `rowVersion`, records actor-scoped idempotency and audit, and
adds an outbox row in the same transaction.

Idempotency is scoped by immutable internal account ID, season, and key—not by
role label or bare OIDC subject. Authentication and current authorization are
evaluated before any idempotency lookup or replay, so a removed or transferred
owner cannot retrieve a formerly stored protected result. Repeating an identical
authorized command returns the stored result; reusing a key with a different
command fingerprint is rejected. Actor-bearing audit metadata uses the same
stable internal account identity while retaining the external issuer/subject
evidence required for attribution.

Round lock and every lifecycle/correction command retain season-wide optimistic
serialization. Every submission mutation acquires the season row serialization
point before reading the round predicate or changing the submission; save,
finalize, commissioner edit, and lock all use the same season-before-submission
lock order. Lock takes the season row lock and prevents further submission
writes through a round-state predicate rechecked while holding that lock in the
same transaction. Therefore a
save racing a lock has exactly one outcome: it commits first and is included in
the frozen input, or it loses with a stable conflict and writes nothing.

PostgreSQL serialization/deadlock failures receive a small bounded server retry
only when the command is demonstrably idempotent. A stale user edit is never
silently rebased or retried against changed data; the UI keeps the dirty buffer
and offers explicit refresh/reapply.

## Falsification and acceptance

The accepted SQLite implementation falsifies a season-only hosted bid guard
without changing production code. `setupCommand` compares every command's
`expectedVersion` with `Season.rowVersion`; `saveSubmission` then increments that
same season version. Consequently, two different teams that load version N and
save independently cannot both succeed: the first save commits N+1 and the
second receives `Stale season version`. This is correct for the local
single-operator queue but creates deterministic cross-team contention once
owners submit remotely. Submission-scoped comparison removes that false conflict
while the mandatory season increment keeps a global invalidation/audit revision.

U3 must run real-PostgreSQL barriers for two owners saving different teams,
same-team competing saves, duplicate retries, and save-versus-lock. If atomic
season revision plus submission guarding cannot be proven without lost updates
or partial audit/outbox state, implementation stops and this ADR is revisited.

## Alternatives rejected

- Season-only guard for bid saves: creates avoidable cross-owner conflicts.
- Submission-only guard for lock/lifecycle: cannot protect a frozen round.
- Last-write-wins or automatic client retry: risks silently replacing sealed bids.
