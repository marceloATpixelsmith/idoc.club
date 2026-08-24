# Canonical authentication reference retrofit

This document tracks IDOC's retrofit to the canonical authentication implementation reference in `marceloATpixelsmith/pixelsmith-auth-reference`. The canonical machine contract governs authentication behavior when older IDOC authentication documentation conflicts with it.

## Canonical baseline

Reference repository: `marceloATpixelsmith/pixelsmith-auth-reference`

Current baseline after reference PR #33:

- contract `1.9.0`
- machine schema `13.0.0`
- validator `10.0.0`
- mapping schema `1.0.0`
- portable-config schema `2.0.0`

The machine contract under `src/contract/` is authoritative. Canonical UI structure and styling come from `src/auth`; application branding is supplied through the reference branding contract rather than by inventing a separate authentication shell.

## IDOC application model

IDOC uses the canonical single-application role model:

- Member
- Admin
- Super Admin

Professional member classifications such as Judge, Steward, Combo Judge/Steward, and Veterinarian are membership-domain attributes, not authentication roles. They must never grant administrator authority.

Existing member IDs, imported legacy mappings, Stripe customer/subscription relationships, membership status, billing history, prices, checkout behavior, webhook handling, renewals, and payment lifecycle code are outside the authentication retrofit and must remain unchanged unless separately reviewed as billing work.

## Canonical login invariant

Normal password login is:

1. email entry;
2. password verification on the trusted server;
3. authoritative email-verification-state evaluation;
4. if the account is unverified, mandatory purpose-bound email verification before normal access;
5. if the account is already verified, skip the email-verification step;
6. applicable MFA/risk policy;
7. authenticated session establishment.

Imported/migrated accounts use exactly the same public sign-in surface. Migration status must not create a special login link, activation choice, or OTP-before-password path. A migrated IDOC member is simply an account whose authoritative email-verification state may initially be unverified. After correct password verification, that member is forced through the same email-verification gate as any other unverified account.

The login surface therefore contains no “Migrated member?”, “Activate your account”, or “Changed your email and need a new verification link?” branch. The retained legacy activation endpoints are compatibility/support surfaces only and are not part of normal login navigation.

## Canonical UI and branding adoption

IDOC authentication pages use the reference shell geometry and responsive behavior rather than an unrelated local layout. IDOC-specific customization is limited to application branding and route values: the IDOC logo, auth background image, application name, terms route, privacy route, and allowed presentation tokens.

The canonical split shell is preserved: 50/50 desktop layout, form content constrained to the canonical 400px width, centered branding, legal copy placement, and the reference mobile behavior with the branded visual retained as a 220px section rather than removed. Shared IDOC auth steps continue to supply real server actions and the real Cloudflare Turnstile implementation; reference preview controls are never treated as backend authority.

## Security alignment already implemented

The retrofit includes trusted Turnstile Siteverify binding, generic login failures, canonical password creation/storage policy with legacy-hash upgrade, persistent layered rate limiting, server-owned authorization boundaries for application roles, session-version invalidation on privileged role changes, and purpose-bound email OTP infrastructure. These remain subject to the canonical contract and regression tests.

The login-order adoption pass corrected the earlier migrated-member flow: anonymous email entry no longer sends a login OTP or branches on account state. Password success is the point after which authoritative email verification is evaluated. Successful OTP verification persists `emailVerifiedAt` before the authenticated session is established.

### Canonical session lifecycle

IDOC's former session cookie was a one-day JWT that middleware extended by another day on each GET. That behavior did not satisfy the reference's separate idle and absolute lifetime requirements because active use could extend a session indefinitely.

The canonical session implementation uses a versioned session payload containing a distinct session identifier, the authoritative user/session-version pair, the original authentication time, the last activity time, and a fixed absolute expiration. The security boundaries are now:

- idle timeout: 30 minutes (`1800` seconds);
- absolute timeout: 12 hours (`43200` seconds) from the original authentication event;
- middleware may advance only `lastActivityAt`; it never moves `authenticatedAt` or `absoluteExpiresAt`;
- token verification fails closed when either lifetime is exceeded or the timestamp relationship is invalid;
- production uses the host-only `__Host-idoc-session` cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`, no Domain attribute, and an explicit absolute expiration;
- every successful authentication creates a new random `sessionId`, so authentication rotates session identity;
- the authoritative `users.sessionVersion` remains an account-wide invalidation boundary after privileged role/security changes;
- the pre-canonical `session` cookie is compatibility-only and is never promoted into the canonical cookie namespace. It ages out under the fixed 12-hour cap or is replaced by a new registered session after successful authentication;
- sign-out and account deletion clear both canonical and legacy cookie names while preserving the required `__Host-` clearing attributes.

### Persisted session registry

Canonical sessions are now backed by the trusted-server `idoc.auth_sessions` registry. A validly signed canonical JWT is not sufficient on its own: authenticated server access also requires a matching active registry row for the same user, `sessionId`, `sessionVersion`, original authentication time, and absolute deadline. Revoked, unknown, or expired registry entries fail closed.

The registry provides the server-side primitives required by the canonical reference for:

- individual session revocation;
- account-wide session revocation;
- active-session inventory;
- persisted last-activity tracking;
- explicit revocation reason/audit context;
- rejection of a stolen or replayed canonical token after its registry row is revoked.

New canonical sessions are inserted into the registry before the authentication cookie is issued. Sign-out revokes the current registry entry before clearing the cookie. The existing `users.sessionVersion` check remains a second, account-wide revocation boundary rather than being replaced by the registry.

## Payment isolation

Authentication retrofit work must not modify Stripe integration, checkout, billing portal, subscription synchronization, membership pricing, payment webhooks, renewal calculations, or imported Stripe customer/subscription relationships. Review of every authentication PR must confirm that payment/billing files are absent from the changed-file list unless the PR is explicitly scoped as billing work.

## Remaining full-reference adoption work

The target is the reference in its totality, not only the login flow. Subsequent slices must close the remaining gaps without crossing the payment boundary:

- user-facing session inventory/revocation controls where required by product policy, remembered lifetime where applicable, and remaining session signing-key rotation semantics;
- complete MFA/TOTP policy, enrollment, routine challenge, recovery codes, authenticator replacement, remembered-device rules, and fresh sensitive-action step-up;
- complete server-owned authentication transaction semantics, replay prevention, atomic single-use evidence, and CSRF protection for cookie-authenticated unsafe mutations;
- canonical Super Admin-only privileged invitation lifecycle and acceptance flow using IDOC application roles;
- full authorization negative testing, direct-resource checks, and tenant-independent single-app role enforcement;
- canonical logging, security events, audit integrity, lifecycle cleanup, secrets/key handling, dependency failure behavior, and production operational evidence;
- canonical UI component/form behavior across sign-in, signup, verification, password recovery/reset, invitation, MFA, recovery-code, and authenticator-management screens;
- final `AUTH-*` implementation/evidence matrix against contract `1.9.0`, schema `13.0.0`, validator `10.0.0`.

## Completion criterion

The retrofit is not complete until every applicable canonical requirement has implementation, test, and operational evidence and the complete auth surface uses the canonical UI/branding contract. Following the reference is not a compliance certification and does not by itself prove the deployed application secure.
