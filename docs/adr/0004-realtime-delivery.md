# ADR 0004: Realtime delivery

- Status: Accepted
- Date: 2026-09-05
- Scope: Phase 3 U1

## Decision

Commands remain ordinary authenticated HTTP requests. Each commit writes a
redacted transactional outbox event containing a monotonic cursor, season ID,
season revision, audience-neutral projection kind, and commit time. It contains
no bid payload, player choice, amount, invite secret, or provider token.

Browsers use one authenticated same-origin SSE stream. Events are invalidation
hints; clients re-fetch an authorized projection and never treat event data as
canonical. `Last-Event-ID` supports replay. A cursor older than retained events
forces full authorized rebootstrap. PostgreSQL notification may wake publishers,
but the outbox—not `LISTEN/NOTIFY`—is replay authority.

Authorization is checked when opening and while servicing a stream. Membership
revocation or ownership transfer closes affected streams. Heartbeats keep
intermediaries from silently expiring connections. Shutdown stops accepting new
streams, drains briefly, and relies on cursor replay after restart.

## Alternatives rejected

- WebSocket command transport: duplicates HTTP correctness and recovery paths.
- Bid data in events: violates the sealed-bid trust boundary.
- Database notifications as history: notifications are not durable replay.
- Refreshing over dirty edits: risks overwriting unsubmitted owner work.
