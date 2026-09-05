# ADR 0002: OIDC identity, invitations, and sessions

- Status: Accepted
- Date: 2026-09-05
- Scope: Phase 3 U1

## Decision

The application supports standards-based OIDC Authorization Code with PKCE and
provider discovery. Auth0 is the first production-supported provider; the
application contract remains provider-neutral and keys external identities by
the immutable `(issuer, subject)` pair. Provider access, refresh, and ID tokens
terminate at the server and are not stored in URLs or browser storage.

The provider-neutral callback contract requires `iss`, `sub`, `aud`, `exp`,
`iat`, and `nonce`; invite redemption additionally requires normalized `email`
and `email_verified=true`. The hosted identity adapter—not routes, application
services, or domain code—performs discovery/JWKS lookup, algorithm allowlisting,
signature and claim validation, authorization-code exchange, PKCE verification,
clock-skew enforcement, and provider error translation. Domain/application code
receives only the verified `(issuer, subject)`, invite-match email, and approved
display metadata.

Each authorization request creates a short-lived, single-use server-side login
transaction that binds a cryptographically random `state`, `nonce`, PKCE
verifier/challenge, issuer, client, and allowlisted return path. The callback
atomically consumes that transaction before establishing a session and rejects
missing, expired, replayed, or mismatched state, nonce, issuer, client, or PKCE
evidence.

The hosted server issues an opaque, random session identifier in a `__Host-`
Secure, HttpOnly, SameSite=Lax cookie. Only a keyed hash of the identifier is
stored. Sessions rotate after login and privilege changes, expire after 30
minutes idle and 12 hours absolute, and require same-origin CSRF protection for
mutations. Logout or account disable revokes all account sessions. Membership
removal or ownership transfer revokes the affected authorization context and
streams immediately; compromise permits global revocation.

Application logout always revokes the local session first. RP-initiated provider
logout is then best-effort using an allowlisted post-logout redirect; its failure
cannot keep the application session alive. Global provider-session logout is not
required for ordinary membership removal or ownership transfer.

There is no public registration. The operator provisions the first commissioner
with a high-entropy bootstrap secret that expires after one hour, is stored only
as a keyed hash, is rate-limited, and is atomically consumed with the first
commissioner binding. Once a commissioner exists, bootstrap remains disabled
unless an explicitly invoked operator recovery procedure resets it. Later invites are commissioner-created,
season/team/role scoped, expire after 24 hours, are single-use, and are delivered
out of band as a URL. Only a hash of the invite secret is stored.

An invite records a canonical intended email: trim surrounding ASCII whitespace,
reject control characters or an invalid addr-spec, convert an internationalized
domain to lower-case IDNA ASCII, and compare both local and domain parts with
locale-independent ASCII case folding. Provider-specific alias transformations
such as dot removal or plus-tag stripping are forbidden. Redemption requires an
authenticated OIDC identity with `email_verified=true` and an exact canonical
match. The transaction consumes the invite, links or creates
the account by `(issuer, subject)`, creates the membership, rotates the session,
and writes audit together. Assignment and transfer atomically reject an account
that already owns another team in the same season; the commissioner may own at
most one team. Email is an invitation constraint, never the durable
identity key. A wrong subject/email, expired, revoked, or replayed invite fails
closed without revealing which condition applied.

Recovery never edits an external identity link silently. The commissioner
revokes and reissues an unconsumed invite. A wrong-account attempt does not
consume the invite and offers sign-out/retry without disclosing the expected
email. For a member who lost provider access, the commissioner performs an
audited ownership transfer to a newly invited identity; historical audit
attribution remains attached to the old subject. If the sole commissioner loses
provider access, an explicitly invoked operator CLI/job uses a separately held
recovery credential to create a short-lived replacement binding, atomically
revokes the old binding and its sessions, preserves historical attribution, and
writes an immutable operator-recovery audit event. It never enables public
registration or silently rewrites the old identity. Invite creation, revocation,
failed redemption class, successful consumption, account linking, membership
creation/removal, and ownership transfer all produce actor-bearing audit events
without storing the raw invite secret or provider token.

## Alternatives rejected

- Application passwords: expands credential and recovery responsibility.
- Binding authority to email or display name: both may change or collide.
- Bearer tokens in browser storage: enlarges the token-exfiltration boundary.
- Built-in email delivery: not required for Phase 3.

## Initial provider alternatives

- **Auth0 (selected):** direct standards support, hosted login, documented
  Authorization Code with PKCE and RP-initiated logout, and a small integration
  surface suit the first deployment. The adapter boundary limits vendor lock-in.
- **Amazon Cognito:** viable managed OIDC, but adds AWS-specific operational and
  configuration coupling without another Phase 3 workload requiring AWS.
- **Microsoft Entra External ID:** viable when the league already standardizes on
  Microsoft identity, but that tenant assumption is not established here.
- **Keycloak:** standards-capable and self-hostable, but contradicts the decision
  to keep credential, recovery, patching, and availability responsibility with a
  managed identity provider for this phase.

The provider choice is replaceable; only the verified-identity callback contract,
not Auth0 SDK types or management APIs, may cross into application code.

## Configuration required later

U4 must supply an Auth0 tenant, client ID/secret, exact callback/logout URLs,
allowed issuer/audience, and signing-key validation. These values are runtime
secrets/configuration and do not reopen this decision.
