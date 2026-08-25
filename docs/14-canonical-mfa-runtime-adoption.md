# Canonical MFA runtime adoption

## Status

This document records IDOC's first adoption slice of the merged `pixelsmith-auth-reference` canonical MFA runtime from reference PR #36.

The initial slice added reusable trusted-server MFA primitives and migration `0020_durable_mfa_persistence` added `PostgresMfaStore`. The live integration now enforces authenticator-app enrollment, routine login TOTP, and authenticator-app verification during password reset for Administrator and Super Admin grants. Ordinary members retain emailed password-reset OTP. General step-up, factor management, and member remembered devices remain separate follow-up work.

## Canonical baseline

The adopted runtime preserves the merged reference behavior for:

- TOTP enrollment using a pending factor plus a short-lived purpose-bound enrollment transaction;
- six-digit, 30-second TOTP codes with a maximum one-step drift window;
- AES-256-GCM protection of TOTP secrets with explicit key IDs;
- routine TOTP verification that requires a trusted challenge transaction ID and challenge purpose (`login`, `password-reset`, or `step-up`);
- replay prevention delegated to an atomic persistence adapter through the accepted TOTP counter;
- recovery codes generated from 16 random bytes (128 bits) each and persisted only as keyed digests;
- recovery-code success yielding restricted `recovery-authorized` authority rather than an unrestricted session;
- remembered-device tokens generated as opaque 32-byte values and persisted only as keyed digests with finite expiry and revocation;
- canonical policy decisions for `super-admin-only`, `privileged-users`, and `all-users` TOTP requirements, with no MFA-off TOTP requirement exposed by the runtime;
- explicit fresh-step-up decisions for sensitive actions.

## IDOC adaptation boundary

The framework-neutral adapter interface is intentionally preserved. IDOC now provides a database-backed implementation that atomically enforces enrollment consumption, TOTP replay prevention, challenge transaction purpose/subject/application binding, attempt limits, recovery-code single use, remembered-device validity and revocation, and factor lifecycle transitions.

IDOC application roles use `administrator` and `super_admin` authorization grants. The live integration loads only current database grants and maps them to the runtime's `admin` and `super-admin` vocabulary. Browser profile/role values and the legacy `users.role` compatibility column are not inputs to this decision. The persistence adapter accepts only the authenticated user's database subject ID and does not make role-policy decisions.

## Durable persistence and store adapter

Migration `0020` durably stores encrypted TOTP factors and key IDs, single-use enrollment transactions, purpose/subject/application-bound challenges with bounded attempt state, keyed recovery-code digests, and opaque remembered-device token digests with finite expiry and revocation state. Plaintext TOTP secrets, recovery codes, and remembered-device tokens are never persisted.

`PostgresMfaStore` implements the canonical `MfaStore` contract with PostgreSQL transactions and row locking for enrollment activation and challenge satisfaction. Accepted TOTP counters advance only while the factor row is locked, recovery-code claims use a conditional single-row update, remembered-device validation requires both an unexpired/unrevoked device and an active owning factor, and factor revocation also revokes its remembered devices. Focused disposable-PostgreSQL tests cover wrong-user and wrong-purpose access, expiry, attempt exhaustion, double-consume and replay races, recovery-code races, device revocation, and factor revocation.

## Adoption status and required follow-up

The privileged login/enrollment slice is wired into the authoritative authentication state machine; the remaining runtime-adoption work is tracked below.

1. **Implemented:** forward-only IDOC migrations for factors, enrollment/challenge transactions, recovery codes, and remembered devices;
2. **Implemented:** a trusted IDOC `MfaStore` implementation with atomic database operations and bounded attempts;
3. **Login/enrollment implemented:** Administrator/Super Admin TOTP enrollment, one-time recovery-code presentation with acknowledgement, and routine login challenge after password or Google primary authentication according to approved IDOC policy;
4. **Implemented:** password-reset MFA handling for privileged accounts, with a persisted purpose-bound TOTP challenge, no email fallback or remembered-device bypass, and fresh sign-in after completion;
5. recovery-authorized authenticator replacement/re-enrollment rather than recovery directly creating a normal session;
6. remembered-device policy only where the approved IDOC policy permits it, never for initial enrollment, recovery/replacement, or explicit fresh step-up;
7. sensitive-action fresh step-up integration, including MFA/security-setting mutations;
8. broader security notifications, audit evidence, session rotation/revocation behavior, and remaining negative/adversarial coverage (the live enrollment and login verification mutations use the existing Server Action boundary and layered persistent rate limiter);
9. replacement and account-security management surfaces (the live enrollment, challenge, and one-time recovery-code surfaces use the canonical auth shell);
10. final production key deployment/UAT and remembered-device digest-key deployment. The live login slice reads `MFA_TOTP_ACTIVE_KEY_ID`, `MFA_TOTP_ENCRYPTION_KEYS` (JSON key-ID to base64url-encoded, exactly 32-byte AES keys), `MFA_RECOVERY_CODE_DIGEST_KEY` (base64url, at least 32 bytes), and `MFA_PENDING_AUTH_SIGNING_KEY` (base64url, at least 32 bytes). Retain old TOTP key IDs in the key ring until all factors are rotated.

The login/enrollment/reset slice does not make the broader MFA program release-complete. Recovery-authorized factor replacement, generic fresh sensitive-action step-up, account-security management UI, broader security notifications/session-revocation integration, member remembered-device behavior, and final production key deployment/UAT remain unfinished.

## Payment isolation

This adoption is authentication-only. It does not modify Stripe integration, checkout, subscriptions, renewal logic, payment webhooks, pricing, imported Stripe relationships, membership billing, or entitlement behavior.
