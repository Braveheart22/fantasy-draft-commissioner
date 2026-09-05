# ADR 0001: Hosted profile boundaries

- Status: Accepted
- Date: 2026-09-05
- Scope: Phase 3 U1

## Context

The accepted server composition in `apps/commissioner/src/server/startup.ts`
binds only to loopback, opens one SQLite database, installs the local trust
boundary, and constructs file-oriented backup, correction, recovery, and
export services. Repository reads accept an actor but commonly do not use it.
Replacing this composition in place would put offline packaging and accepted
recovery behavior at risk.

## Decision

Keep the existing local composition root and SQLite Prisma schema/migrations.
Add a separate hosted composition root with hosted trust policy, authentication,
authorization, PostgreSQL adapters, realtime publishing, and hosted operations.
Application and Phase 1 domain services remain deployment-neutral and must not
branch on a profile flag.

PostgreSQL receives a separate Prisma schema, generated client, and immutable
migration lineage. A repository contract suite proves semantic parity. Hosted
application commands execute state, stable-principal audit, idempotency result,
season revision, and outbox insertion in one database transaction.

File-specific maintenance is exposed behind ports before hosted adapters are
introduced. Local backup/restore remains SQLite-specific; hosted backup/restore
is an operator function and is never implemented by copying database files.

## Alternatives rejected

- Switching the existing Prisma datasource in place: obscures provider-specific
  migrations and risks the accepted package.
- A profile flag throughout services: couples domain behavior to deployment.
- Retiring SQLite: contradicts the retained offline-product requirement.

## Consequences

Parity tests and two explicit composition roots are required. Some adapter code
will be duplicated intentionally where SQLite and PostgreSQL have different
transaction or maintenance semantics.
