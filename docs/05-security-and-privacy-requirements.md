**IDOC**

**Security & Privacy Requirements**

Production hardening requirements for member data, administration, Render PostgreSQL, authentication and Stripe

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.1                                            |
| **Date**             | 11 August 2026                                 |

Working project document. Update this document when project decisions change.

# 1. Security objective

Protect member identity, professional information, membership entitlement and billing references through defense in depth. The starter template is scaffolding; production security depends on the IDOC-specific data model, authorization rules, deployment configuration and operational practices.

# 2. Mandatory controls

| **Control**                   | **Requirement**                                                                                                                                                                                                                      |
|-------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Authentication                | Use the application's authentication system with verified email changes, secure session handling and documented account-lifecycle controls.                                                                                            |
| Authorization                 | Every sensitive server action/route checks the authenticated actor and required role/permission.                                                                                                                                     |
| Member data isolation         | Keep the Render PostgreSQL database inaccessible to browsers. Enforce authenticated-user ownership and administrator permissions in every server-side data operation, using default-deny behavior.                                   |
| Database credential isolation | The Render PostgreSQL connection URL and credentials are server-only Vercel environment variables; never expose them through NEXT_PUBLIC\_\* variables, client bundles or browser responses. Production connections require TLS/SSL. |
| Stripe secrets                | Stripe secret and webhook signing secret are server-only Vercel environment variables.                                                                                                                                               |
| Webhook verification          | Reject Stripe events that fail signature verification.                                                                                                                                                                               |
| Input validation              | Validate type, length, enum values and business rules server-side for every mutation.                                                                                                                                                |
| Rate limiting                 | Protect authentication-adjacent, recovery, activation, contact and sensitive write endpoints.                                                                                                                                        |
| Security headers              | Deploy CSP and appropriate HSTS, frame, MIME, referrer and permissions controls.                                                                                                                                                     |
| Audit logging                 | Record privileged changes and automated entitlement changes with enough data to reconstruct what happened.                                                                                                                           |
| Error handling                | Do not leak stack traces, secrets, database details or account existence to anonymous users.                                                                                                                                         |
| Backups                       | Enable and verify recoverable database backups appropriate to the production tier.                                                                                                                                                   |

# 3. Member data isolation objectives

Release 1 data-access functions resolve the actor from the server session, load server-managed active application-role grants, and then apply owner-or-administrator checks before private profile, role, membership, audit, or entitlement access. Registration and email-change verification store only a SHA-256 token digest. The raw random token exists only while the server constructs and sends the one-hour Mailchimp Transactional link; it is never returned in action state or persisted. Claiming a token is atomic, single-use, replay-safe, and invalidates earlier outstanding links for the account. Database triggers reject updates and deletes to audit and profile-change history.

- A normal member can read only their own private profile, membership, professional roles and approved payment summary.

- A normal member cannot write membership status, validity dates, payment records, administrator flags, or audit records. Members may update approved signup and professional fields only through the server-side validation/history workflow.

- Administrator access is not granted solely by a client-controlled profile column.

- Server-side administrative operations use trusted authorization and narrowly scoped database operations.

- Audit records are append-only to ordinary application roles.

# 4. Administrator security

- Administrator and Super Admin grants require canonical TOTP after password or Google primary authentication and during password reset. Password recovery uses a persisted, purpose-bound challenge with no email fallback or remembered-device bypass; accounts without an active factor fail closed to support recovery. Reset completion revokes persisted sessions and requires fresh sign-in. During privileged sign-in, a canonical recovery code may authorize only short-lived authenticator replacement: the old factor and its remembered devices are retired atomically after proof of the new factor, recovery codes are rotated, prior sessions are revoked, and no normal session is issued until the new codes are acknowledged. Privileged sensitive actions now require a persisted purpose=`step-up` TOTP challenge and a five-minute signed authority bound to the exact active canonical session, user, application, session version, authoritative role, and one canonical sensitive action. Remembered devices and passwords do not satisfy explicit step-up; existing password confirmation remains additive; successful verification creates no normal session; authority is consumed after mutation and cleared at logout.

- Use least privilege: membership administrators should not automatically receive deployment, database or Stripe secret access.

- Every administrator action requires an audit entry. Sensitive actions such as suspending membership, changing paid-through dates, granting complimentary membership, deciding a refund consequence, merging identities or changing admin roles also require an explicit reason and before/after values where applicable.

- Do not expose migration/import tooling to normal authenticated users.

- Disable or remove temporary migration endpoints after cutover.

# 5. Account activation and enumeration

Public-facing signup, login-email entry, activation, and password-recovery boundaries must not disclose whether an email belongs to a member or reveal account state before successful credential verification. Rate-limit these requests and keep outward behavior account-existence neutral.

# 6. Data minimization

- Store only the personal data required for IDOC membership operations.

- Do not copy irrelevant WordPress usermeta into the new platform.

- Do not store full payment card data; Stripe remains the PCI-scoped payment processor.

- Do not duplicate sensitive Stripe objects when identifiers and summarized billing state are sufficient.

- Define retention for migration exports and delete/safely archive temporary exports after acceptance.

# 7. Secure development and deployment

- Protect the production branch with pull-request review/checks appropriate to the project.

- Keep production and preview environment variables separated.

- Never use production Stripe secret keys in public/preview deployments that are accessible to untrusted code.

- Run dependency/security scanning and keep Next.js, Drizzle ORM/Kit, the PostgreSQL driver, the application authentication dependencies and the Stripe SDK current.

- Review Vercel build logs and source maps for accidental secret leakage.

- Use Vercel's platform protections as an additional layer, not as a replacement for application authorization.

# 8. Vercel Pro security and deployment controls

Vercel Pro strengthens the deployment perimeter and operations; it does not replace IDOC server-side authorization, database ownership checks, validation, or Stripe webhook verification.

| **Control** | **Approved IDOC use** | **When to implement** |
|---|---|---|
| Environment separation and protected previews | Separate Production, Staging/UAT and Preview values. Preview uses non-production data and Stripe test mode only; protect private feature previews. | Foundation |
| Firewall / WAF | Use managed protections plus narrowly scoped rate limits for auth, recovery, verification/resend, email changes, contact forms, Stripe webhooks and sensitive admin mutations. | Before public account and admin flows |
| Sensitive Environment Variables | Store production secrets as sensitive server-only values; never expose them in logs, browser responses, source maps or documentation. | Before entering production secrets |
| Observability and Runtime Logs | Investigate server errors, latency, failed background work and deployments without logging secrets or unnecessary personal data. | Before UAT |
| Cron Jobs | Use only as a scheduler for authenticated, idempotent, database-backed jobs. Record outcomes and prevent duplicate effects. | After the related workflows are complete |
| GitHub deployment integration | Preview each PR; deploy Production only from approved `main` merges. CI remains the merge gate. | Foundation |
| Fluid Compute | Keep default Vercel server execution; do not place long migrations/imports in requests. | Default |
| Workflows / Queues | Do not add initially. Re-evaluate only if Cron plus database-backed jobs cannot safely coordinate durable recovery, imports, delivery or wait lists. | When that trigger is reached |

## 8.1 Firewall and Cron verification

- Test normal member sign-in, verification, recovery, administrator operations, Stripe webhook delivery and preview access after material firewall changes.
- Every scheduled endpoint validates a server-only scheduler secret, is idempotent, writes durable safe run evidence, and alerts on repeated failures or missed expected runs.

# 9. Security acceptance checklist

| **Test**               | **Pass condition**                                                                                                                                                       |
|------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Cross-account read     | Member A cannot read Member B's private records even with crafted requests.                                                                                              |
| Cross-account write    | Member A cannot alter Member B or privileged fields on self.                                                                                                             |
| Role escalation        | No client request can assign administrator permissions.                                                                                                                  |
| Webhook forgery        | Invalid/missing Stripe signatures are rejected.                                                                                                                          |
| Webhook replay         | Duplicate event ID does not duplicate payment/entitlement effect.                                                                                                        |
| Secret exposure        | No server secret appears in browser source, network responses or public env variables.                                                                                   |
| SQL/data-access review | The database is not exposed directly to browsers; all server-side queries and mutations have reviewed ownership and role checks with no broad authenticated access path. |
| Enumeration            | Anonymous signup/login-email/activation/recovery boundaries do not reveal membership existence or account state.                                                        |
| Admin audit            | Sensitive admin action produces immutable audit evidence.                                                                                                                |
| Backup restore         | Restore procedure has been tested or provider-supported recovery verified.                                                                                               |
| Protected preview      | A private PR preview cannot be accessed by an unapproved viewer and uses only non-production data and secrets.                                                          |
| Firewall/WAF           | Endpoint rules protect abuse paths without blocking legitimate traffic or verified Stripe webhooks.                                                                      |
| Scheduled jobs         | Each deployed job rejects unauthenticated invocation, is idempotent, records outcome and alerts on repeated failure.                                                    |

# 10. Official references

- Render: PostgreSQL documentation - https://render.com/docs/postgresql

- Drizzle ORM: Migrations - https://orm.drizzle.team/docs/migrations

- Stripe: Webhooks - [<u>https://docs.stripe.com/webhooks</u>](https://docs.stripe.com/webhooks)

- Vercel: Stripe Subscription Starter - [<u>https://vercel.com/templates/other/subscription-starter</u>](https://vercel.com/templates/other/subscription-starter)

- Vercel: Security - https://vercel.com/docs/security
- Vercel: Firewall - https://vercel.com/docs/vercel-firewall
- Vercel: Cron Jobs - https://vercel.com/docs/cron-jobs
- Vercel: Observability - https://vercel.com/docs/observability

## Release 1 recovery and account-state enforcement

Anonymous recovery and activation requests always return the same neutral response. Eligible accounts receive a Mailchimp Transactional message from `accounts@idoc.club`; a replacement digest is committed and earlier links invalidated only after delivery succeeds, under a per-user transactional lock. Delivery failure records a non-sensitive audit outcome and preserves the previously delivered usable link for safe retry. Raw tokens and passwords are neither persisted nor included in action state, audit payloads, logs, or redirects. Only the necessary inbound link carries the raw token. Successful reset increments the session version, invalidating existing signed sessions. Migrated activation additionally validates the imported profile against the canonical classification schema and requires one imported `wp_user` mapping, a migration-sourced membership foundation, and its preserved billing linkage before credentials or account state can change; reconciliation failure retains only a categorical audit reason and leaves the token usable after the foundation is corrected. Unverified, suspended, migrated-pending, and deleted identities are rejected during ordinary authenticated-user resolution regardless of membership dates; onboarding identities are limited to profile completion, and expired active members may authenticate only to the documented account-maintenance and future renewal/billing boundaries.

### Anonymous account-link abuse and timing controls

Recovery and migrated activation have independent persistent limits keyed by HMAC-like SHA-256 derivations over the normalized email and request-origin signal with a server-only rate-limit secret; raw IP addresses and raw account identifiers are not retained in rate-limit records. Every result remains neutral. Eligible and ineligible paths perform bounded cryptographic work and apply a 350 ms minimum response floor plus 0–49 ms jitter after database work and outside transactions. Raw account-link tokens exist only in transient memory and an AES-256-GCM encrypted outbox payload; ordinary token, audit, rate-limit, and history columns contain no raw token.

Account-delivery encryption uses `ACCOUNT_DELIVERY_KEY_VERSION` as the active version and a server-only JSON object in `ACCOUNT_DELIVERY_ENCRYPTION_KEYS` that maps accepted versions to key material. New records store only the active version label; pending records resolve their stored version at delivery time, which permits controlled rotation while an older key remains explicitly present. Removing a retired version makes its records fail safely. Resolved keys and decrypted payloads are never persisted or logged, and payload shape is validated after authenticated AES-256-GCM decryption.

Operational recovery failures are logged only as a purpose and a non-sensitive category (`configuration`, `encryption`, `database`, or `operational`). The anonymous response remains neutral, while email addresses, origin values, raw tokens, decrypted payloads, exception text, and environment values are excluded from this evidence.

The account-delivery Cron endpoint accepts only an `Authorization: Bearer` value matching the server-only `CRON_SECRET`; query parameters are never an authentication path. Authentication is rejected before outbox access. Its public result is limited to non-sensitive counts, and worker-level failure evidence contains only the safe `operational` category. Token eligibility is checked atomically at claim and again under a database lock immediately before external delivery, so expired, consumed, missing, wrong-user, or wrong-purpose tokens are terminalized without payload decryption or provider calls.

Delivery evidence is categorical: stable message and entity identifiers, timestamps, attempt counts, and the approved success, retry, ineligibility, lease-loss, or dead-letter reason are retained. It must not contain member addresses, request origins, authorization headers, raw/decrypted tokens or payloads, passwords, exception text or stacks, database/provider responses or connection values, or resolved encryption, rate-limit, Cron, database, or provider secrets. Provider retries reuse the original message identity. The worker makes at most six attempts with `min(3600, 30 * 2^(attempt - 1))` seconds of backoff, and successful delivery does not consume the delivered account token; a later successfully delivered replacement is the point at which older same-purpose tokens are invalidated.

## Production build and runtime boundary

Production compilation must succeed without privileged configuration and without provider access. Privileged clients initialize only at runtime, their modules use the supported `server-only` boundary, and build-only fake credentials or bypass flags are prohibited. Runtime configuration rejects missing, blank, malformed, and undersized values categorically without echoing supplied values. Browser-visible build output is scanned for privileged names and unique secret sentinels.

## Identity-check endpoint denial semantics

`GET /api/user` reports the current session's identity, or `null`, for header/UI display and must be safely callable by anonymous visitors on every page load. It authorizes through `requireAccountAccess('profile')` exactly like any other privileged read; a denial (anonymous visitor, or an account state — onboarding, suspended, deleted, unverified — that must not display as logged in) is caught and resolved to `null` with a 200, matching what "not logged in" already means everywhere else in the app, rather than a distinct error-shaped body. Only `AuthorizationError` is treated as an expected denial this way; any other exception (a database failure, for example) propagates uncaught to a 500 so an operational failure is never silently reported as "signed out."

## Signup, login, and password-reset email verification (OTP) and bot-check

Signup, the legacy-member login activation step, and password reset are each a step-flow (email, 6-digit code, then password) tracked by its own signed, 15-minute pending cookie (`idoc_pending_signup`, `idoc_pending_login`, `idoc_pending_password_reset` respectively) distinct from the real session cookie; signup additionally creates no `users` row until its password step succeeds. Every flow-entry email step requires a passing Cloudflare Turnstile token. The trusted server verifies it against `TURNSTILE_SECRET_KEY`, the configured deployment hostname derived from `BASE_URL`, and the exact trusted flow action (`signup`, `login`, or `password-reset`) before the authentication transaction advances; missing, failed, hostname-mismatched, or action-mismatched verification fails closed. Codes are 6 digits from a CSPRNG, stored only as a SHA-256 digest with a 15-minute expiry, and reuse the `account_request_limits` table for a purpose-prefixed (`email_otp_<purpose>`) issue/resend rate limit and a 30-second resend cooldown. Verification is capped at 5 attempts per issued code; exceeding it locks that code and requires a fresh one. All of this validation is re-asserted server-side in the Server Action regardless of what the client already checked, so a JavaScript-disabled submission is validated identically to a JavaScript-enabled one. Verification emails are sent through the existing Mailchimp Transactional integration from `accounts@idoc.club`, using a single shared branded HTML shell (`lib/notifications/email-template.ts`'s `renderTransactionalEmail`, plus an `emailCode`/`emailButton` helper for the two recurring content shapes — a copyable code or a call-to-action link). Every transactional email in the system renders through this one shell — member-facing (OTP codes, the email-change verification link, password-reset/migration-activation links, renewal/expiration/grace notices) and the administrator profile-change alert alike — so there is one place to update branding, and a future move to admin-editable templates has a single seam to extend rather than a rewrite of each call site.

A code is always persisted (hashed) before the send is attempted, so a delivery failure never leaves a member unable to retry: `issueEmailOtp` catches a `sendTransactionalEmail` failure, logs only a categorical, non-sensitive outcome (`configuration`, `network`, or `operational` — never the exception text, matching `lib/membership/account-recovery.ts`'s existing `operationalFailureCategory` evidence contract) and returns a distinct `delivery_failed` status. Every Server Action that issues or resends a code (signup, the legacy-member login step, password reset) surfaces this as a plain, actionable message instead of letting the exception propagate to a generic error boundary.

Login's first email step (`startLogin`) is account-existence neutral. After the Turnstile and rate-limit checks succeed, every syntactically valid email advances to the password step without looking up or exposing account existence or account state. The password step then uses the same generic credential failure for unknown, unverified, suspended, deleted, or otherwise ineligible accounts. Legacy `migrated_pending` members use the separate neutral activation route; retained legacy-login OTP handlers exist only to finish already-started compatibility flows. Password reset (`/recover-password`) remains fully neutral and advances to the same OTP-entry state regardless of account eligibility while only eligible accounts receive a code.

A `migrated_pending` legacy pre-launch member's login OTP step (purpose `login_verification`) feeds into `activateMigratedAccountByUserId` in `lib/membership/account-recovery.ts`, a second entry point alongside the original email-link `consumeAccountToken` path (still intact and reachable at `/request-activation` + `/activate`, now an unlinked support-only fallback). Both entry points share the same foundation-validation logic (`validateMigrationActivationFoundation`) and the same validate-before-claim ordering: an incomplete imported-profile/role/entitlement/mapping foundation leaves the identity proof (token or OTP) unconsumed and only records a categorical reconciliation-required audit reason, exactly as before. Both also share `applyMigrationActivationMutation`, whose actual state-changing `UPDATE` is conditioned on `accountState = 'migrated_pending'` and checks that a row was actually affected — the concurrency gate that makes two simultaneous activation submissions (e.g. a double form submit) resolve to exactly one success rather than one silently overwriting the other's password. A newly activated legacy member is redirected to `/dashboard/profile?confirmDetails=1` — their already-imported profile, pre-filled, with a confirmation banner — rather than a blank onboarding form.

## Rate limiting: independent IP and normalized-email limits

Every auth-adjacent form (signup, login, password reset, and OTP resend/verify on each) requires a passing Turnstile challenge plus two **independent** rate limits — one keyed only by the requesting IP address, one keyed only by the normalized email address — so that varying either alone (rotating IPs against one email, or one IP against many emails) cannot bypass the other. This supersedes the current single combined `(purpose, identifier_hash, origin_hash, window_started_at)` bucket in `account_request_limits` (`lib/auth/email-otp.ts`'s and `lib/membership/account-recovery.ts`'s `takeAllowance`), which only limits the exact (email, IP) pair together and lets either dimension be varied to defeat the other. The email- and IP-derived hashes reuse the existing HMAC-like SHA-256-over-`RATE_LIMIT_HASH_KEY` construction; raw IP addresses and raw email addresses are never retained, matching the existing anonymous-recovery evidence contract.

Every issued OTP code, regardless of which of the three purposes issued it, keeps the properties already implemented in `lib/auth/email-otp.ts`: single-use, 15-minute expiry, CSPRNG-generated, stored only as a SHA-256 digest, a 30-second resend cooldown, a 5-attempt-per-code verification lockout, and a `purpose` binding (`signup_verification`, `login_verification`, `password_reset`) that a code issued for one purpose can never satisfy for another. Verification attempts are additionally subject to the same IP/email rate limiting as issuance, not just the per-code attempt lockout, so repeatedly requesting fresh codes cannot be used to grind through more guesses than the per-code lockout alone would allow.

## Device-trust ("remember me") for login verification

A returning member on a device that has never completed login verification (or whose trust has expired/been revoked) is emailed a 6-digit code (purpose `login_verification`), exactly like the existing legacy-activation OTP but for ordinary returning members rather than only `migrated_pending` accounts. That code-entry screen offers a "Remember me for 2 weeks" checkbox. Checking it issues a second, separate host-only cookie containing a random 32-byte opaque credential (only its keyed digest is persisted) (distinct from the `session` cookie and from every flow's pending-step cookie) that, for 2 weeks, lets that specific device skip login verification for that specific account; leaving it unchecked skips issuing that cookie entirely, so the next login on that device verifies again. This is unrelated to the account-creation email-verification step and unrelated to the anonymous password-reset/migration-activation link mechanism. Administrators and Super Admins never receive this option — every privileged login re-verifies the second factor (TOTP, below), with no persistent device trust. The implementation binds each record to the IDOC application, exact user, fixed 14-day expiry, and the account session version at issue. Use never extends expiry; revocation and expiry take effect on the next login. Password reset, password change, verified email change, and privileged role transitions increment `sessionVersion`, invalidating prior trust. Account eligibility and authoritative current grants are checked before trust, so deleted, suspended, migrated-pending, Administrator, and Super Admin accounts cannot use the bypass.

## Administrator and Super Admin multi-factor authentication (TOTP)

Administrator and Super Admin accounts use authenticator-app TOTP as their second factor for login after either password or Google primary authentication, with no remembered-device bypass. The live login slice is implemented: durable encrypted TOTP factors, enrollment transactions, purpose-bound login challenges, bounded attempts, replay prevention, one-time recovery-code display/digest persistence, and a signed short-lived pre-session continuation all gate normal session issuance. A privileged account with no active factor is enrolled before login can complete; a privileged account with an active factor must satisfy a persisted `login` challenge. The plaintext TOTP secret is presented only for authenticator setup and is not persisted, and plaintext recovery codes are displayed only in their one-time acknowledgement flow. Privileged password-reset MFA and recovery-authorized authenticator replacement are implemented. Recovery remains inside trusted privileged primary authentication, never creates a session directly, and requires new-factor proof plus acknowledgement of newly rotated recovery codes. Canonical privileged sensitive-action step-up is implemented; broad account-security management remains separate follow-up work.

## Password policy

Passwords require 12–128 characters. Spaces and Unicode are allowed, paste is allowed, and the password is preserved exactly as entered: do not trim, normalize, silently truncate, or impose composition rules such as mandatory uppercase/lowercase/digit/symbol classes. New password storage uses versioned Argon2id. Existing bcrypt hashes remain accepted only as a migration format and are upgraded to the current Argon2id format after a successful credential verification.

## Client-side error reporting

`POST /api/client-error` accepts a best-effort crash report from the client error boundaries (`app/error.tsx`, `app/global-error.tsx`) and writes it to server runtime logs only — it is never persisted to the database. It requires no authorization, since it must remain reachable from a broken or anonymous session; each field (`digest`, `message`, `stack`, `url`) is capped at 2,000 characters and any non-string value is dropped before logging.

## Member account-security management

`/dashboard/security` is the canonical authenticated account-security surface. It lists only the current member's active, unexpired persisted sessions and identifies the current session from the server-authenticated canonical session ID. Members may log out an owned non-current session or all other sessions without invalidating the current session. No bearer value, cookie content, invented device label, or unpersisted network metadata is rendered.

Ordinary members can see whether the current browser has valid 14-day login trust, forget the server-read current credential, or revoke all of their ordinary IDOC login-trust records. Administrator and Super Admin accounts never receive this ordinary-device UI. Privileged accounts instead see their active authenticator status and enter the existing recovery-authorized replacement state machine; recovery codes remain one-time and new codes are issued only by that canonical replacement flow.

Password change retains current-password and privileged fresh-step-up checks, increments `sessionVersion`, revokes the current registry session, clears the browser session, and deliberately returns the member to sign-in. Account deletion retains password confirmation, requires the canonical privileged step-up policy where applicable, revokes all persisted sessions and ordinary trusted devices, and then clears authentication. Management mutations record secret-free audit evidence.
