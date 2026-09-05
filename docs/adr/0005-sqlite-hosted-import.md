# ADR 0005: SQLite-to-hosted import

- Status: Accepted
- Date: 2026-09-05
- Scope: Phase 3 U1

## Decision

Import is one-way and season-creating only. It never synchronizes back to the
offline package and never merges into an existing hosted season. The source
SQLite database and manifest are immutable inputs.

Uploads are capped at 256 MiB, one import at a time per deployment, and 30
minutes wall-clock. They enter a newly created disposable directory with a 1
GiB total quota. Inspection runs in a separate least-privilege worker/container
with no network, no production database credentials, no extension loading, a
read-only source mount, a 1 CPU/1 GiB memory limit, and a writable scratch mount.
Cancellation or failure removes scratch artifacts; rejected uploads are deleted
within 24 hours and successful inputs within 7 days after the receipt is stored.
PostgreSQL owns admission through a renewable import lease/advisory lock, plus
unique constraints for import identity, receipt, and destination season; this
preserves exclusivity across replicas and process restarts.

The worker verifies manifest format and hash, SQLite integrity, supported schema
version, migration on a disposable copy, and canonical relational fingerprints.
It emits a versioned, bounded canonical representation and dry-run report over a
bounded channel. Worker output remains untrusted: before display or insertion,
the application validates its schema version, byte and record counts, IDs,
lengths, enums, relational references, and hashes, and accepts no worker-chosen
filesystem path or executable content. The application then requires explicit
commissioner confirmation and performs one PostgreSQL
transaction that preserves application IDs, row versions, active/superseded
history, audit order and attribution, snapshots, checkpoints, corrections,
catalog/pricing lineage, and results. It does not infer accounts or owners.

An import identity is the source database SHA-256 plus manifest SHA-256 and
season ID. A repeated successful identity returns its immutable receipt. Any
collision with an existing season or conflicting receipt is rejected; no
partial rows remain. Imported `LOCAL_COMMISSIONER` audit evidence remains
historical and is never rewritten as a hosted principal.

Import is an administrative ingestion transaction, not an ordinary season
command. It preserves the imported season `rowVersion` and every historical
audit row exactly. The immutable import receipt and operator audit record live
in hosted operational metadata outside the imported season revision lineage,
and no season outbox event is emitted until a later ordinary hosted command.
Simultaneous confirmation or retry after worker/application restart resolves to
one immutable receipt or a stable conflict with zero partial season rows.

## Alternatives rejected

- Opening an uploaded database in the application process: crosses a hostile
  parser/file boundary with production secrets available.
- Running SQLite migrations against PostgreSQL: providers have distinct syntax
  and invariants.
- Merge/sync import: makes provenance and rollback ambiguous.
