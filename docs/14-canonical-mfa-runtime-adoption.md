# Canonical MFA runtime adoption

## Status

This document records IDOC's first adoption slice of the merged `pixelsmith-auth-reference` canonical MFA runtime from reference PR #36.

The initial slice added reusable trusted-server MFA primitives and migration `0020_durable_mfa_persistence` added `PostgresMfaStore`. The live integration now enforces authenticator-app enrollment, routine login TOTP, and authenticator-app verification during password reset and recovery-authorized authenticator replacement for Administrator and Super Admin grants. Ordinary members retain emailed password-reset OTP. Fresh sensitive-action step-up is now integrated for privileged password and email changes, privileged role grant/revocation, and Google identity security-setting mutations. Factor management surfaces remain separate follow-up work; ordinary-member returning-login trust is implemented separately from factor-bound TOTP devices.

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
5. **Implemented:** recovery-authorized authenticator replacement/re-enrollment; a consumed code grants only a short-lived signed continuation, replacement atomically retires the old factor and its remembered devices, rotates recovery codes, revokes existing sessions, increments `sessionVersion`, and issues a normal session only after one-time code acknowledgement;
6. **Implemented for approved ordinary-member password login:** untrusted returning members complete emailed `login_verification`; optional opaque, digest-only, revocable device trust lasts a fixed 14 days and is bound to user, application, and `sessionVersion`. It is stored separately from factor-bound TOTP remembered devices. Administrator and Super Admin grants never consult it and continue TOTP on every login; it never applies to enrollment, recovery/replacement, Google member login, or explicit fresh step-up;
7. **Implemented:** sensitive-action fresh step-up integration for live privileged mutations: password changes retain current-password verification, email changes are gated only when the address changes, Super-Admin role grant/revocation rechecks authority, and Google identity link/unlink retains current-password verification. The reusable five-minute signed TOTP authority is bound to the exact active canonical session, user, application, session version, authoritative role, and one `SensitiveAction`; it is consumed after a successful mutation, cleared on logout, and never creates or rotates a normal session;
8. **Implemented:** broader security notifications, safe append-only audit evidence, session rotation/revocation verification, and remaining negative/adversarial coverage. High-risk events use the existing durable retry/dead-letter delivery architecture with recipient snapshots and dedupe; provider failure does not reverse committed security mutations;
9. **Implemented:** `/dashboard/security` is the canonical member-facing management surface for password and Google sign-in, owned active sessions, ordinary-member remembered login devices, privileged authenticator/recovery entry, and account deletion. Current-session identity comes from the server-owned canonical session; other-session and device revocation preserve ownership and do not expose credentials. Privileged replacement reuses the recovery-authorized state machine and standalone recovery-code regeneration is intentionally not introduced;
10. **Repository readiness implemented; production secret deployment and operator UAT pending:** the authoritative inventory, rotation procedures, deployment destinations, UAT checklist, and unchecked release signoff are in document 07. Runtime parsing now rejects non-canonical base64url key material in addition to missing, malformed, undersized, wrong-length, and incomplete key rings. Actual production values have not been installed and manual signoff has not been claimed. Ordinary login trust additionally reads `LOGIN_DEVICE_TRUST_DIGEST_KEY` (base64url, at least 32 bytes). The live login slice reads `MFA_TOTP_ACTIVE_KEY_ID`, `MFA_TOTP_ENCRYPTION_KEYS` (JSON key-ID to base64url-encoded, exactly 32-byte AES keys), `MFA_RECOVERY_CODE_DIGEST_KEY` (base64url, at least 32 bytes), and `MFA_PENDING_AUTH_SIGNING_KEY` (base64url, at least 32 bytes). Retain old TOTP key IDs in the key ring until all factors are rotated.

The login/enrollment/reset slice does not make the broader MFA program release-complete. Item 8 is implemented. The repository-side portion of item 10 is complete. Actual production secret installation, provider configuration, deployed verification, and operator UAT remain unfinished and are release gates. The account-security management surface does not make those release gates complete.

## Password-creation guidance

IDOC password creation requires at least 12 characters plus at least one uppercase letter, one lowercase letter, one number, and one special character. The member-facing guidance is progressive: each unmet requirement is shown and disappears immediately when satisfied. The 128-character ceiling remains enforced server-side but is not advertised as normal guidance; it is surfaced only when the entered password exceeds that maximum. Passwords are preserved exactly as entered and are not trimmed, normalized, or silently truncated.

## Payment isolation

This adoption is authentication-only. It does not modify Stripe integration, checkout, subscriptions, renewal logic, payment webhooks, pricing, imported Stripe relationships, membership billing, or entitlement behavior.
