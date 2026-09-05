# ADR 0006: Self-hosting, backup, and recovery

- Status: Accepted
- Date: 2026-09-05
- Scope: Phase 3 U1

## Decision

The initial topology is one region: an OCI application image behind a TLS
reverse proxy, PostgreSQL on a separate persistent volume/service, and backup
storage independent from both. Application replicas are stateless. Migrations
run once under a deployment lock before readiness; replicas never run development
migration commands.

PostgreSQL receives a nightly `pg_dump --format=custom` backup after migrations.
The backup is encrypted client-side with an age X25519 recipient before upload
to an S3-compatible object store in a separate operator account/bucket with
versioning and Object Lock in compliance mode. Each object receives a retention
date at least as long as its applicable daily, weekly, or monthly class. Retain 14 daily, 8 weekly, and 12 monthly recovery
points through lifecycle rules without deleting a still-locked version. Backup
jobs place a manifest containing PostgreSQL/schema/application versions,
snapshot time, size, and SHA-256 inside the client-encrypted archive and copy its
SHA-256 into Object-Lock-protected object metadata. Restore verifies both before
use. This avoids a second long-lived signing key while binding integrity metadata
to the encrypted, immutable recovery point. Monitoring alerts on failure, missed 24-hour
age, unexpected size, or verification failure. For the initial 5 GiB database
envelope, this simpler logical restore is preferred over continuous WAL/PITR;
the latter remains an operational upgrade if a future RPO is below 24 hours.

The public encryption recipient may reside on the backup host. The private age
identity is available only through a recovery-specific secret-manager role, with
a sealed offline recovery copy held by the project owner; it is not stored in
PostgreSQL, the web/backup containers, repository, object-store account, logs, or
backup manifest. The web application has no object-store or decryption access.
The backup credential may create objects in only its prefix and cannot read,
delete, bypass retention, or administer the bucket. A separate recovery role may
read backups but cannot change retention. Key rotation creates new backups for
the new recipient while old private identities remain escrowed through their
retention window.

A quarterly rehearsal retrieves and decrypts the newest eligible backup under
the recovery role, validates its manifest/hash, restores with `pg_restore` into
an isolated database whose network is limited to a verification runner, and
applies no unreviewed migration. It runs database integrity, migration-ledger,
relational-fingerprint, authorization-smoke, and lifecycle-smoke checks; records
backup age and elapsed restore time; and then destroys the rehearsal environment.
Production cutover is a distinct, explicitly authorized procedure. Acceptance
requires a successful backup no older than 24 hours and a rehearsed end-to-end
restore within four hours.

## Alternatives rejected

- Backup on the primary volume: shares the primary failure domain.
- Provider-only snapshots without export verification: weak portability and
  integrity evidence.
- Continuous WAL archiving/PITR in the initial release: adds retention and
  restore-chain complexity that the accepted 24-hour recovery point does not
  require; revisit if that RPO is tightened.
- Application-triggered PostgreSQL restore: gives the web process destructive
  infrastructure authority.

## Deployment configuration required later

U9 must name the concrete S3-compatible endpoint/region, secret manager, alert
destination, and responsible operator. Those choices may vary by installation
provided they preserve this trust and recovery contract.
