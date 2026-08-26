# Canonical authentication reference retrofit

This document tracks IDOC's retrofit to the canonical authentication implementation reference in `marceloATpixelsmith/pixelsmith-auth-reference`. The canonical machine contract governs authentication behavior when older IDOC authentication documentation conflicts with it.

## Canonical baseline

Reference repository: `marceloATpixelsmith/pixelsmith-auth-reference`

Current baseline after reference PR #35:

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

Google-authenticated sessions pass through IDOC's canonical session establishment and the live privileged MFA policy. Administrator and Super Admin primary authentication is followed by canonical TOTP enrollment/challenge as required, and authenticated sensitive actions use a separate fresh purpose-bound `step-up` challenge rather than treating the normal session as sufficient authority.

## Canonical Google identity linking

Reference PR #35 defines the reusable linking/unlinking behavior without changing the `1.10.0` normative contract. IDOC adopts that behavior rather than linking accounts by matching email addresses.

The implemented linking boundary is:

- the member must already have an authenticated IDOC session;
- the member must freshly verify the current password before a link flow begins;
- fresh verification expires after five minutes and is stored in a signed, `HttpOnly` server-authenticated cookie;
- privileged Administrator/Super Admin link and unlink mutations additionally require canonical fresh TOTP step-up under the current sensitive-action policy;
- the Google OAuth transaction is explicitly marked `external_identity_link` and bound to the authenticated IDOC user ID;
- the callback rejects any mismatch between the OAuth transaction's authenticated user and the current IDOC session;
- only the canonical Google issuer is accepted;
- issuer + Google `sub` remains the stable external identity key;
- concurrent link attempts are serialized and the persistence layer returns authoritative collision outcomes;
- the identity row, immutable security audit evidence, and a durable user-security notification outbox record are persisted in one database transaction;
- disconnecting Google requires fresh current-password verification and is allowed only through the canonical Google issuer path;
- successful link and unlink operations enqueue a security email handled by the existing account-delivery cron cadence.

Google-only accounts created through provider signup do not know the random internal password hash used to satisfy the current non-null database credential column. They therefore cannot disconnect their sole Google sign-in method through the password-verified unlink control, which preserves the canonical requirement not to strand an account without a usable primary authentication method. A future password-establishment flow may provide such accounts an alternate primary method before unlinking.

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

The retrofit includes trusted Turnstile Siteverify binding, generic login failures, canonical password creation/storage policy with legacy-hash upgrade, persistent layered rate limiting, server-owned authorization boundaries for application roles, session-version invalidation on privileged role changes, purpose-bound email OTP infrastructure, persisted session revocation, hardened canonical Google OIDC, explicit authenticated Google identity linking/unlinking, privileged TOTP enrollment and routine challenge, password-reset MFA, recovery-authorized authenticator replacement, and action-bound fresh TOTP step-up for live privileged sensitive mutations. Implemented step-up authority is bound to the current canonical session and intended sensitive action and is backed by a persisted single-use step-up challenge.

## Remaining full-reference adoption work

The target is the reference in its totality, not only password login and Google OIDC. Remaining work includes:

- complete remaining MFA/TOTP adoption work beyond the implemented ordinary-member 14-day login trust policy, especially broader account-security management and any sensitive mutations not yet exposed by the product UI;
- user-facing session inventory/revocation controls where required by product policy and remaining session signing-key rotation semantics;
- remaining server-owned authentication transaction semantics, CSRF protection for cookie-authenticated unsafe mutations, and negative/adversarial coverage not already implemented by the persisted canonical MFA/session flows;
- canonical Super Admin-only privileged invitation lifecycle and acceptance flow using IDOC application roles;
- full authorization negative testing, direct-resource checks, and single-app role enforcement;
- canonical logging, security events, audit integrity, lifecycle cleanup, secrets/key handling, dependency failure behavior, and production operational evidence;
- canonical UI surfaces that do not yet exist in IDOC because their trusted-server feature slices are still pending, including invitation, broader authenticator/account-security management, and session-management screens. MFA enrollment/challenge, recovery-code, authenticator-replacement, and fresh step-up surfaces now exist;
- final `AUTH-*` implementation/evidence matrix against contract `1.10.0`, schema `13.0.0`, validator `10.0.0`.

## Completion criterion

The retrofit is not complete until every applicable canonical requirement has implementation, test, and operational evidence and the complete auth surface uses the canonical UI/branding contract. Following the reference is not a compliance certification and does not by itself prove the deployed application secure.


## IDOC ordinary-member login trust

Ordinary password login now applies the approved IDOC-specific flow after password and eligibility checks: authoritative grants are resolved; privileged grants continue to canonical TOTP without consulting ordinary trust; an ordinary member either presents a valid user/application/session-version-bound opaque trusted-device credential or completes a purpose-bound emailed `login_verification` OTP. Opting in after successful OTP creates fixed 14-day server-revocable trust. This persistence is separate from canonical factor-bound `mfa_remembered_devices`; it never applies to Google login, privileged login, enrollment, recovery, replacement, or step-up.

## Account-security management retrofit

The live `/dashboard/security` page now presents the canonical registry-backed session inventory, using the authenticated server session ID for its current-session marker and ownership-scoped revocation. Ordinary members can manage the separate ordinary login-trust credential; privileged users instead receive an entry into the existing recovery-authorized authenticator replacement state machine. Password changes deliberately clear the now-version-stale session and account deletion revokes session/device credentials before completion. No secret or raw credential material crosses the rendered management boundary.
