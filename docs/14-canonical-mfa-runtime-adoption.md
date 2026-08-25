# Canonical MFA runtime adoption

## Status

This document records IDOC's first adoption slice of the merged `pixelsmith-auth-reference` canonical MFA runtime from reference PR #36.

The initial slice added reusable trusted-server MFA primitives. The persistence retrofit now adds migration `0020_durable_mfa_persistence` and a PostgreSQL-backed `PostgresMfaStore`. It still does **not** change IDOC's login, password-reset, Google OIDC, session-establishment, or account-settings behavior, and it does not add user-facing MFA routes. Those integrations remain separate follow-up work.

## Canonical baseline

The adopted runtime preserves the merged reference behavior for:

- TOTP enrollment using a pending factor plus a short-lived purpose-bound enrollment transaction;
- six-digit, 30-second TOTP codes with a maximum one-step drift window;
- AES-256-GCM protection of TOTP secrets with explicit key IDs;
- routine TOTP verification that requires a trusted challenge transaction ID and challenge purpose (`login` or `step-up`);
- replay prevention delegated to an atomic persistence adapter through the accepted TOTP counter;
- recovery codes generated from 16 random bytes (128 bits) each and persisted only as keyed digests;
- recovery-code success yielding restricted `recovery-authorized` authority rather than an unrestricted session;
- remembered-device tokens generated as opaque 32-byte values and persisted only as keyed digests with finite expiry and revocation;
- canonical policy decisions for `super-admin-only`, `privileged-users`, and `all-users` TOTP requirements, with no MFA-off TOTP requirement exposed by the runtime;
- explicit fresh-step-up decisions for sensitive actions.

## IDOC adaptation boundary

The framework-neutral adapter interface is intentionally preserved. IDOC now provides a database-backed implementation that atomically enforces enrollment consumption, TOTP replay prevention, challenge transaction purpose/subject/application binding, attempt limits, recovery-code single use, remembered-device validity and revocation, and factor lifecycle transitions.

IDOC application roles currently use `administrator` and `super_admin` authorization grants. The runtime's canonical role vocabulary remains `admin` and `super-admin`; a later policy integration layer must perform an explicit trusted-server mapping rather than accepting a client-provided role string. The persistence adapter accepts only the authenticated user's database subject ID and does not make role-policy decisions.

## Durable persistence and store adapter

Migration `0020` durably stores encrypted TOTP factors and key IDs, single-use enrollment transactions, purpose/subject/application-bound challenges with bounded attempt state, keyed recovery-code digests, and opaque remembered-device token digests with finite expiry and revocation state. Plaintext TOTP secrets, recovery codes, and remembered-device tokens are never persisted.

`PostgresMfaStore` implements the canonical `MfaStore` contract with PostgreSQL transactions and row locking for enrollment activation and challenge satisfaction. Accepted TOTP counters advance only while the factor row is locked, recovery-code claims use a conditional single-row update, remembered-device validation requires both an unexpired/unrevoked device and an active owning factor, and factor revocation also revokes its remembered devices. Focused disposable-PostgreSQL tests cover wrong-user and wrong-purpose access, expiry, attempt exhaustion, double-consume and replay races, recovery-code races, device revocation, and factor revocation.

## Required follow-up before MFA is enabled

A later integration slice must wire the persisted runtime into the authoritative authentication state machine. Current status:

1. **Implemented:** forward-only IDOC migrations for factors, enrollment/challenge transactions, recovery codes, and remembered devices;
2. **Implemented:** a trusted IDOC `MfaStore` implementation with atomic database operations and bounded attempts;
3. administrator/Super Admin TOTP enrollment and routine challenge after password or Google primary authentication according to approved IDOC policy;
4. password-reset MFA handling for privileged accounts;
5. recovery-authorized authenticator replacement/re-enrollment rather than recovery directly creating a normal session;
6. remembered-device policy only where the approved IDOC policy permits it, never for initial enrollment, recovery/replacement, or explicit fresh step-up;
7. sensitive-action fresh step-up integration, including MFA/security-setting mutations;
8. security notifications, audit evidence, session rotation/revocation behavior, CSRF/rate-limit coverage, and negative/adversarial tests;
9. user-facing enrollment, challenge, recovery-code, replacement, and account-security surfaces aligned with the canonical auth UI;
10. production key configuration and documented rotation for TOTP encryption, recovery-code digests, and remembered-device digests.

Until those follow-ups are implemented and verified, the presence of `lib/auth/mfa` must not be treated as proof that IDOC MFA is enabled or release-complete.

## Payment isolation

This adoption is authentication-only. It does not modify Stripe integration, checkout, subscriptions, renewal logic, payment webhooks, pricing, imported Stripe relationships, membership billing, or entitlement behavior.
