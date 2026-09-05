# Phase 3 Preservation Matrix

| Accepted boundary | Current evidence | Phase 3 preservation mechanism | Required proof |
|---|---|---|---|
| Phase 1 allocation, tie, budget, roster and 14-player rules | Root `src/`, `test/`; Phase 1 frozen suite | Domain and engine adapters remain unchanged and storage/auth neutral | Frozen 35-test suite plus hosted adapter equality |
| Lifecycle and monotonic season revision | `season-repository.ts`, lifecycle service, SQLite store | Hosted transaction port and PostgreSQL constraints; lifecycle commands retain season serialization | Repository contract and concurrent lifecycle tests |
| Zero-to-three sealed bids and round-lock immutability | Auction service/repository and frozen snapshots | Audience-specific authorization; submission OCC; lock serializes on season and round | Cross-owner disclosure matrix and save-versus-lock barriers |
| Stable audit, idempotency, snapshots, correction lineage | `AuditEvent`, `FrozenSnapshot`, `Checkpoint`, `CorrectionAction` | Stable subject actor; atomic state/audit/idempotency/outbox; IDs and lineage preserved on import | PostgreSQL parity, retry, correction and import fingerprints |
| Local offline Windows package | Local loopback composition and SQLite migration/recovery | Existing composition retained; hosted profile is additive | Packaged production E2E and offline-network guard |
| Local restart, backup, restore and recovery | File backup coordinator and recovery service | SQLite behavior unchanged; hosted infrastructure recovery is separate | Existing recovery suite plus isolated PostgreSQL restore rehearsal |
| Demo/production isolation | Separate demo entry point and production isolation tests | Hosted image and startup exclude demo routes/assets/fixtures | Route probe and production artifact scan |
| U13 catalog preparation and 10,000-player usability | Catalog preparation adapters/specs and Phase 2.5 budgets | No draft-time provider dependency; accepted search/approval budgets retained | Catalog contract and performance profile |
| Sealed-bid privacy | Current masking plus lock/reveal lifecycle | Deny-by-default policy below routes; distinct owner/commissioner/shared DTOs; redacted events/errors/logs | Authorization matrix across HTTP, SSE, cache, logs and exports |
| Deterministic exports and immutable fixture hashes | Export service and fingerprinted persistence fixtures | Import preserves canonical IDs/history and compares fingerprints | Before/after relational and export hashes |

Phase 3 does not alter keeper cost, auction budgets, roster positions, auction
engine mapping, tie semantics, fixed draft order, correction semantics, or
catalog/pricing lineage. Automated valuations, projections, news, provider league
imports, co-owners, public signup, spectator mode, mobile apps, and owner
conventional drafting remain out of scope.
