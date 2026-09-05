# ADR 0007: Initial hosted capacity and performance budgets

- Status: Accepted
- Date: 2026-09-05
- Scope: Phase 3 U1

## Supported envelope

The first production release supports:

- 25 leagues and 50 retained seasons in one deployment;
- one application replica initially; correctness must remain database-backed and
  restart-safe so a later multi-replica deployment does not change semantics;
- 16 teams/owners per season, with one commissioner who may also own one team;
- 4 simultaneous active drafts across the deployment;
- 3 browser tabs per owner and 2 commissioner tabs per active season;
- 60 SSE connections per active season and 240 deployment-wide;
- 10 application requests per second sustained and 40-command bursts for 10 seconds;
- the accepted 10,000-player catalog per season;
- at least 100,000 append-only audit rows per season without truncation or
  command rejection; this is a tested sizing and alerting threshold, not a
  destructive cap;
- at least 100,000 outbox rows per season and seven days of outbox replay, after
  which only outbox rows may be pruned;
- a 256 MiB SQLite import and 5 GiB PostgreSQL database;
- 20 GiB uncompressed logical-backup/restore input.

This is a supported ceiling, not a domain limit. Inputs beyond a configured
limit fail explicitly; they are not silently truncated.

## Performance budgets

On the documented staging/reference host at the envelope above:

- authorized bootstrap p95 <=500 ms;
- 100-result catalog search p95 <=150 ms and response <=256 KiB, preserving the
  accepted Phase 2.5 budget;
- bid save/finalize p95 <=300 ms, excluding client network transit;
- committed change to SSE receipt p95 <=1 second;
- SSE reconnect and replay p95 <=2 seconds, or full rebootstrap p95 <=3 seconds
  after a retention gap;
- outbox unpublished age p95 <=1 second and never exceeds 30 seconds while healthy;
- graceful deployment drain <=15 seconds;
- database pool usage remains below 80% under the acceptance workload.

U3, U7, and U10 record machine/container/database configuration with results.
A missed budget blocks acceptance or requires an explicitly approved revision;
it must not be hidden by weakening the workload.

## Rationale and alternatives

The envelope covers a conventional league, every owner online, commissioner
redundancy, concurrent saves, and several simultaneous leagues without claiming
internet-scale operation. Unlimited initial capacity was rejected because it
provides no sizing or backpressure contract. A one-league-only target was
rejected because it would not exercise tenant scoping or deployment contention.
