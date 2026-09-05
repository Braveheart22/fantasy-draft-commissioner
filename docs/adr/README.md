# Phase 3 Architecture Decision Index

Phase 3 adds a hosted, authenticated profile around the accepted Phase 2.5
application. These records are prerequisites for implementation; they do not
change the Phase 1 domain or the local SQLite package.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-hosted-profile-boundaries.md) | Separate hosted composition and PostgreSQL persistence | Accepted |
| [0002](0002-oidc-identity-invitations-and-sessions.md) | Provider-neutral OIDC with Auth0 as the first supported provider | Accepted |
| [0003](0003-hosted-write-concurrency.md) | Submission-scoped bid concurrency plus season serialization at lifecycle boundaries | Accepted |
| [0004](0004-realtime-delivery.md) | Transactional outbox with authenticated SSE invalidation | Accepted |
| [0005](0005-sqlite-hosted-import.md) | Isolated, bounded, one-way SQLite import | Accepted |
| [0006](0006-self-hosting-backup-and-recovery.md) | Single-region self-hosting with encrypted independent backups | Accepted |
| [0007](0007-initial-hosted-capacity.md) | Initial supported capacity and performance budgets | Accepted |

The [preservation matrix](phase3-preservation-matrix.md) maps the accepted
system boundaries to the Phase 3 mechanisms that protect them.

The records capture the approved U1 architecture. The concurrency ADR records
the completed baseline falsification. Provider tenant identifiers, public URLs,
backup destination credentials, and encryption keys are deployment
configuration, not architecture decisions.
