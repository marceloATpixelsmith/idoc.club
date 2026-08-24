# Canonical authentication reference retrofit

This document tracks IDOC's retrofit to the canonical authentication implementation reference in `marceloATpixelsmith/pixelsmith-auth-reference`. The canonical machine contract governs authentication behavior when older IDOC authentication documentation conflicts with it.

## Canonical baseline

Reference repository: `marceloATpixelsmith/pixelsmith-auth-reference`

Current baseline after reference PR #34:

- contract `1.10.0`
- machine schema `13.0.0`
- validator `10.0.0`
- mapping schema `1.0.0`
- portable-config schema `2.0.0`

The machine contract under `src/contract/` is authoritative. Canonical UI structure and styling come from `src/auth`; application branding is supplied through the reference branding contract rather than by inventing a separate authentication shell.

## IDOC application model

IDOC uses the canonical single-application role model: Member, Admin, and Super Admin. Professional member classifications such as Judge, Steward, Combo Judge/Steward, and Veterinarian are membership-domain attributes, not authentication roles and must never grant administrator authority.

Existing member IDs, imported legacy mappings, membership status, and non-authentication domain behavior remain outside the authentication retrofit unless separately reviewed.

## Canonical password login invariant

Normal password login is:

1. email entry;
2. password verification on the trusted server;
3. authoritative email-verification-state evaluation;
4. mandatory purpose-bound email verification when the account is still unverified;
5. applicable MFA/risk policy;
6. authenticated session establishment.

Imported/migrated accounts use the same public sign-in surface. Migration status does not create a special login link, activation choice, or OTP-before-password path.

## Canonical UI and branding adoption

IDOC authentication pages use the reference shell geometry and responsive behavior. IDOC-specific customization is limited to application branding and route values. The production Cloudflare widget remains real and server-verified and uses the canonical light/flexible presentation.

The 24 August 2026 UI parity pass aligned the implemented login, signup, verification, recovery, reset, and compatibility auth surfaces with the canonical reference geometry, copy, and controls.

## Canonical Google OIDC adoption

Reference PR #34 established Google OIDC as a real canonical provider instead of a UI-only control. IDOC now adopts that implementation contract directly.

The canonical environment contract is exactly:

```text
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
```

IDOC's canonical provider flow uses:

- start route `/api/auth/google/start`;
- callback route `/api/auth/google/callback`;
- Google issuer `https://accounts.google.com`;
- CSPRNG OAuth `state`;
- OIDC `nonce`;
- PKCE S256;
- a 15-minute maximum OAuth transaction lifetime;
- a signed, `HttpOnly`, `SameSite=Lax` browser-binding cookie tied to the exact OAuth state and verified before callback transaction consumption, preventing login-CSRF callback swapping;
- an authentication-adjacent per-origin rate limit on anonymous OAuth transaction creation;
- bounded OAuth transaction retention with cleanup of expired and consumed records;
- persistent trusted-server transaction storage with atomic single-use consumption;
- exact `applicationId`, application-origin, redirect-URI, and transaction binding;
- same-origin-only return destinations with ASCII control-character and backslash rejection;
- authorization-code exchange at Google's token endpoint;
- Google JWKS signature verification;
- exact issuer, audience, nonce, token lifetime, RS256 algorithm, and multi-audience `azp` validation;
- stable external identity based on issuer + `sub`;
- no automatic account linking based only on email equality.

The Google buttons on login and signup now point to the canonical start route. A previously linked external identity may authenticate the corresponding eligible account. A first Google authentication may create a new onboarding account only when Google supplies a verified email and no existing IDOC account already uses that email. If an IDOC account already uses the email but has no linked Google identity, authentication fails closed and requires explicit authenticated account linking rather than silently attaching the provider identity.

Google-authenticated sessions still pass through IDOC's canonical session establishment. Future MFA/step-up policy remains authoritative after primary authentication when those slices are implemented.

## Canonical session lifecycle

IDOC uses versioned, persisted canonical sessions with a distinct random session identifier, authoritative user/session-version pair, original authentication time, last activity time, fixed absolute expiration, and the trusted-server `idoc.auth_sessions` registry.

The security boundaries are:

- idle timeout: 30 minutes (`1800` seconds);
- absolute timeout: 12 hours (`43200` seconds) from the original authentication event;
- middleware may advance only last activity, never original authentication or absolute expiration;
- production uses the host-only `__Host-idoc-session` cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`, no Domain attribute, and explicit absolute expiration;
- every successful authentication creates a new random `sessionId`;
- `users.sessionVersion` remains an account-wide invalidation boundary;
- a signed JWT alone is insufficient: a matching active registry record is required;
- sign-out revokes the registry entry before clearing the cookie.

## Security alignment already implemented

The retrofit includes trusted Turnstile Siteverify binding, generic login failures, canonical password creation/storage policy with legacy-hash upgrade, persistent layered rate limiting, server-owned authorization boundaries for application roles, session-version invalidation on privileged role changes, purpose-bound email OTP infrastructure, persisted session revocation, and the hardened canonical Google OIDC provider flow described above.

## Remaining full-reference adoption work

The target is the reference in its totality, not only password login and Google OIDC. Remaining work includes:

- explicit authenticated external-identity linking and unlinking controls consistent with the canonical account-linking policy;
- complete MFA/TOTP policy, enrollment, routine challenge, recovery codes, authenticator replacement, remembered-device rules, and fresh sensitive-action step-up;
- user-facing session inventory/revocation controls where required by product policy and remaining session signing-key rotation semantics;
- complete server-owned authentication transaction semantics, replay prevention, atomic single-use evidence, and CSRF protection for cookie-authenticated unsafe mutations;
- canonical Super Admin-only privileged invitation lifecycle and acceptance flow using IDOC application roles;
- full authorization negative testing, direct-resource checks, and single-app role enforcement;
- canonical logging, security events, audit integrity, lifecycle cleanup, secrets/key handling, dependency failure behavior, and production operational evidence;
- canonical UI surfaces that do not yet exist in IDOC because their trusted-server feature slices are still pending, including invitation, MFA, recovery-code, authenticator-management, session-management, and step-up screens;
- final `AUTH-*` implementation/evidence matrix against contract `1.10.0`, schema `13.0.0`, validator `10.0.0`.

## Completion criterion

The retrofit is not complete until every applicable canonical requirement has implementation, test, and operational evidence and the complete auth surface uses the canonical UI/branding contract. Following the reference is not a compliance certification and does not by itself prove the deployed application secure.
