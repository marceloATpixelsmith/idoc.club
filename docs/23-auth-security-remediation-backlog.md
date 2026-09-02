# 23. Authentication and Security Remediation Backlog

## Authority, baseline, and counting method

This is the actionable closure backlog derived from the current canonical `pixelsmith-auth-reference`
machine contract and the production-path re-audit recorded in document 22. The reference artifacts report
contract `2.0.0`, machine schema `14.0.0`, validator `11.0.0`, mapping schema `1.0.0`, and portable-config
schema `2.0.0`. The audit independently expanded grouped matrix labels and reproduced **155 unique
canonical AUTH IDs**: after Slice 3 (Authorization and privilege) closed AUTH-STORAGE-002,
AUTH-LIFECYCLE-002, AUTH-PASSWORD-005, AUTH-IDENTITY-005, AUTH-AUTHZ-005, and AUTH-API-004, Slice 4
(CSRF/request integrity) closed AUTH-CSRF-003, Slice 5 (Credential and key lifecycle) closed
AUTH-STORAGE-005, AUTH-STORAGE-006, AUTH-CRYPTO-003, AUTH-OPERATIONS-005, AUTH-SECRET-001,
AUTH-CRYPTO-004, and AUTH-DEPENDENCY-001 (narrowing AUTH-SECRET-004 without fully closing it), Slice 6
(Privacy and logging) closed AUTH-IDENTITY-003, AUTH-API-003, AUTH-LOG-001, AUTH-LOG-003, and
AUTH-PRIVACY-001, Slice 7 (Operations and observability) closed AUTH-ERROR-001, AUTH-EMAIL-002,
AUTH-OPERATIONS-004, AUTH-OPERATIONS-006, and AUTH-OPERATIONS-007, and Slice 8 (Deployment readiness
and operational validation) closed AUTH-OPERATIONS-010 and closed the repository-addressable half of
AUTH-OPERATIONS-008 and AUTH-OPERATIONS-011 (both remain `partial`, gated on external/operational
evidence), each with real behavioral evidence, current status is **145 verified, 0
implemented-but-unverified, 3 partial, 0 missing, and 7 not-applicable**. Consequently, the table below
has exactly **3 applicable non-verified controls**.

`EXTERNAL/MANUAL` is a closure/evidence boundary in this document, not a sixth mutually exclusive status
in document 22. A control can have repository implementation verified while its deployed configuration or
provider exercise remains external. No statement here is a production-readiness claim.

## Row-level closure backlog

Each row is one canonical ID. Locations and callers name the current production path, not a parallel test
store. “Existing evidence” is deliberately candid when it is only source inspection.

| Canonical ID | Canonical requirement | Current classification | Exact unmet property or evidence deficiency | Production implementation location | Actual production caller/path | Persistence/config location | Existing behavioral evidence | Why current evidence is insufficient | Closure type | Severity | Exploitability | Exact acceptance criteria | Required behavioral test | Recommended remediation slice | Dependencies | Blocks application-code readiness? | Blocks production deployment validation? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTH-SECRET-004 | Validate production secret strength and separation for every security purpose. | partial | Pepper is explicitly optional in the canonical requirement and genuinely absent here — treated as **not-applicable** for the pepper half (never claimed, never implemented, no false "implemented" claim). OAuth client secret now has real bounded-overlap replacement, rollback, and retirement support (`lib/auth/google-oidc-reference.ts`'s versioned rotation ring) plus a real, secret-free audit function (`lib/auth/google-oidc-secret-audit.ts`) — the sole remaining gap is that recording a rotation depends on an operator actually running `pnpm google:rotate-secret` after redeploying; a pure environment-variable change has no application code path that runs "at the moment" it happens, so there is no way to force this automatically without adding a database read to a currently DB-free, synchronous config path (a disproportionate architectural cost for this one property). | Pepper: **not implemented** — `lib/auth/password-hash.ts` has no pepper concept at all (Argon2id with per-password salt only). OAuth client secret: `lib/auth/google-oidc-reference.ts` `googleOauthClientSecret`/`loadGoogleOidcConfig` (versioned ring + rollback), `lib/auth/google-oidc-secret-audit.ts` `recordGoogleOauthSecretRotation`/`latestGoogleOauthSecretRotation`, `scripts/rotate-google-oauth-secret.ts` (operator CLI) | Production route/action importing or invoking the named implementation; close with a call-path test rather than a parallel helper. | N/A / `idoc.audit_log` | `tests/google-oauth-secret-rotation.test.ts` (unit, real config parser: resolve/rollback/retire/fail-closed); `tests/google-oauth-secret-audit.integration.ts` (real Postgres: audit record persisted and read back correctly) | The rotation/rollback/retirement mechanism itself is now real and behaviorally proven; only the audit trail's dependence on a manual runbook step (not an automatic hook) remains unclosed, and is disclosed rather than claimed away. | TEST | low | operational | Add an automatic, code-level trigger that records a rotation without relying on an operator remembering to run the script — e.g. a lazy, memoized comparison against `latestGoogleOauthSecretRotation()` the first time `loadGoogleOidcConfig()` runs in a process, if judged worth the added DB dependency on this path. | Use the production route/action/function with real Postgres, signed cookies/JWTs, or Chromium as technically appropriate; assert success, denial, persistence, and concurrency/expiry boundaries. | Slice 5 | Production database/provider/configuration where named; otherwise existing test harness. | no | no |
| AUTH-OPERATIONS-008 | Revocation, consumption, replay, roles, memberships, authorization versions, rate limits and key state MUST be cross-instance consistent and use monitored trusted UTC time with bounded skew. | partial | Cross-instance consistency is achieved architecturally (single Postgres source of truth, no local/in-memory caches for revocation/roles/rate-limits found). The clock-skew half is now implemented and behaviorally proven in the repository (`lib/observability/clock-skew-check.ts`, `tests/clock-skew-check.integration.ts`, a scheduled cron route). What remains open is exclusively external/operational: confirming the cron actually fires in the deployed environment and an operator actually receives a real alert on real drift — this control's own acceptance criteria require both the repository gap and dated operator evidence closed, not either alone. | `idoc.auth_sessions` (single shared Postgres instance — no per-instance state), `idoc.account_request_limits` (shared rate-limit buckets), role checks always re-read from `idoc.application_roles` per request (`lib/membership/data-access.ts`); `lib/observability/clock-skew-check.ts` (new), `app/api/cron/clock-skew-check/route.ts` (new) | Production route/action importing or invoking the named implementation; close with a call-path test rather than a parallel helper. | `idoc.auth_sessions`, `idoc.application_roles`, `idoc.account_request_limits` | `tests/clock-skew-check.integration.ts` (real Postgres, drives the real `measureClockSkewMs`/`runClockSkewCheck`, proves a genuinely injected skew in either direction triggers an alert and normal skew never does) | Cross-instance consistency and the clock-skew mechanism are now behaviorally proven; a real deployed cron actually firing and an operator actually receiving a real production alert is external/operational evidence this repository cannot produce on its own. | OPERATIONS | low | operational | Obtain dated operator confirmation that the deployed cron fires on schedule and that a real drift event (or a deliberate test trigger) produces a received alert. | External/operational: no further repository behavioral test is meaningful here — see the deployed-environment confirmation above. | Slice 8 (repository half complete) | Production database/provider/configuration where named; otherwise existing test harness. | no | yes |
| AUTH-OPERATIONS-011 | Production readiness MUST be an explicit machine-readable evidence checklist covering security configuration, stores, testing, operations, ownership and recovery, never a certification or automatic security claim. | partial | `docs/25-release-readiness-checklist.json` (new) is now that machine-readable artifact, CI-integrity-enforced against drift and against self-certification without evidence (`scripts/validate-release-checklist.mjs`). What remains open is exclusively external/operational: an operator actually filling in real, dated evidence for a real production release — the committed manifest is, correctly, entirely `"unchecked"`, since a template cannot itself constitute readiness evidence. | `docs/25-release-readiness-checklist.json`, `scripts/validate-release-checklist.mjs` (new); mirrors docs/07 §15.6 "Release signoff (leave unchecked until manually proved)" | Production route/action importing or invoking the named implementation; close with a call-path test rather than a parallel helper. | N/A | `tests/validate-release-checklist.test.ts` (real, drives the actual `validateChecklist`/`extractRunbookItems`: proves the real docs/07 and docs/25 agree with zero drift today, and that drift, a missing-evidence "verified" claim, and an ambiguous "unchecked"-with-evidence state are each independently caught) | The machine-readable artifact and its anti-drift/anti-self-certification enforcement are now real and behaviorally proven; a real operator filling it in with dated evidence for an actual release is external/operational evidence this repository cannot produce on its own. | OPERATIONS | low | operational | Obtain a real, dated, evidence-backed completion of `docs/25-release-readiness-checklist.json` for an actual production release, validated by `scripts/validate-release-checklist.mjs`. | External/operational: no further repository behavioral test is meaningful here — see the dated operator completion above. | Slice 8 (repository half complete) | Production database/provider/configuration where named; otherwise existing test harness. | no | yes |

## Ordered remediation slices

3. **Authorization and privilege — AUTH-STORAGE-002, AUTH-LIFECYCLE-002, AUTH-PASSWORD-005,
   AUTH-IDENTITY-005, AUTH-AUTHZ-005, AUTH-API-004. COMPLETE — all six controls verified.** TEST.
   Real-Postgres/real-Chromium behavioral tests were added in
   `tests/authorization-privilege-boundaries.integration.ts`, `tests/role-grants.integration.ts`, and
   `tests/security-e2e/api-authorization-disclosure.spec.ts`, driving the real production
   `signIn`/`completeSignup`, `updatePassword`, `linkGoogleIdentity`/`unlinkGoogleIdentity`,
   `grantApplicationRole`/`revokeApplicationRole`, `logOutSession`, and `/api/user` boundaries for both
   their positive and adversarial cases. This pass also found and fixed a real production defect: the
   Google-identity-linking audit-log write passed untyped bind parameters into `jsonb_build_object(...)`,
   which real PostgreSQL rejects (`42P18`), meaning linking or unlinking a Google identity would have
   thrown the first time either code path actually ran in production. See docs/22 for the per-control
   evidence detail. Direct cross-account and lifecycle-state requests were proven, not merely
   architected, to be unable to mutate or distinguish protected resources.
4. **CSRF/request integrity — AUTH-CSRF-003. COMPLETE — verified.** CODE+TEST. A signed double-submit-
   cookie CSRF token was implemented (`lib/security/csrf-tokens.ts`, `lib/security/csrf.ts`) alongside the
   existing Origin-header validation: unpredictable (CSPRNG nonce), signed and expiring (4-hour JWT),
   session-bound (`sessionRef` claim checked against the caller's live session id), issued/rotated at
   `setSession()`/`clearSession()`, and enforced on every mutating Server Action either through the
   `validatedAction`/`validatedActionWithUser` wrappers or an explicit call at the top of the handful of
   bare actions outside them. Real-browser behavioral tests were added to `tests/security-e2e/csrf.spec.ts`
   proving a tampered form field and a removed CSRF cookie both reject an otherwise-valid, correctly
   authenticated, same-origin mutation on the real production path; `tests/security-e2e/mfa-production-
   boundaries.spec.ts` exercises the token across a real mid-flow session rotation. Every real-Postgres
   integration suite that drives a `validatedAction`-wrapped Server Action directly now threads a real,
   production-issued token, so that existing adversarial coverage continues to prove the requirement too.
   This pass also found and fixed a real production defect: an attempt to preserve Partial Prerendering's
   static shell for the root layout (by moving the per-request CSRF-cookie read behind a Suspense
   boundary) silently degraded a deep `redirect()` call — including an anonymous visitor's `/admin`
   authorization check — from a real HTTP 3xx into a client-JS-only redirect, so the route returned HTTP
   200 instead. Confirmed with a real dev-server request, then fixed by keeping that read synchronous and
   unwrapped, accepting the app-wide loss of the (experimental, opt-in) PPR static shell as the explicit
   tradeoff for guaranteed-correct authorization/CSRF behavior. See docs/22 for the full evidence detail.
5. **Credential and key lifecycle — AUTH-STORAGE-005, AUTH-STORAGE-006, AUTH-CRYPTO-003,
   AUTH-OPERATIONS-005, AUTH-SECRET-001, AUTH-CRYPTO-004, AUTH-DEPENDENCY-001. COMPLETE — all seven
   controls verified; AUTH-SECRET-004 narrowed but remains open (see its row above).** TEST and
   CODE+TEST. `tests/password-hash-migration.integration.ts` drives the real production `signIn` path
   against a real bcrypt-hashed Postgres row, proving rehash-on-login and that the upgraded hash still
   authenticates (AUTH-STORAGE-005). `tests/auth-recovery-adversarial.integration.ts` drives a genuine
   enrollment/recovery/replacement/acknowledgement cycle through the real production Server Actions and
   scans every MFA-adjacent table for raw secret/recovery-code leakage (AUTH-STORAGE-006, AUTH-CRYPTO-003).
   `tests/security-e2e/google-oauth.spec.ts` forces a real, unrecognized-kid JWKS refresh at the exact
   moment the (real, in-suite) mock identity provider's key endpoint is failing, proving the real callback
   route fails closed without leaking raw provider error text (AUTH-OPERATIONS-005).
   `tests/build-runtime-boundary.build.ts` now scans the real production build's complete output for the
   Google OAuth client secret alongside every other production secret (AUTH-SECRET-001).
   `lib/auth/mfa/key-lifecycle.ts` computes an explicit pending/active/retiring/retired/compromised state
   per MFA encryption key ID from real `idoc.mfa_factors` usage, proven end to end in
   `tests/totp-key-ring.integration.ts` (AUTH-CRYPTO-004). `lib/security/dependency-risk-register.ts`
   names every critical dependency's declared failure posture explicitly, held against real forced-failure
   behavior by `tests/dependency-risk-register.test.ts` (AUTH-DEPENDENCY-001). `lib/auth/google-oidc-
   reference.ts`/`google-oidc-secret-audit.ts` add a real bounded-overlap rotation ring, rollback,
   retirement, and secret-free audit trail for the Google OAuth client secret, proven in
   `tests/google-oauth-secret-rotation.test.ts` and `tests/google-oauth-secret-audit.integration.ts` —
   AUTH-SECRET-004 remains `partial` only because recording the audit trail depends on an operator running
   `pnpm google:rotate-secret` rather than an automatic code hook (a pure environment-variable change has
   no application code path that runs "at the moment" it happens); see its row above for the precise,
   narrower remaining gap and a concrete option for closing it.
6. **Privacy and logging — AUTH-IDENTITY-003, AUTH-API-003, AUTH-LOG-001, AUTH-LOG-003,
   AUTH-PRIVACY-001. Slice 6 (this pull request): all five controls verified.** CODE+TEST.
   `tests/email-identity-normalization.integration.ts` drives the real production `completeSignup` Server
   Action against real Postgres, proving NFC-normalized deterministic case-insensitive identity plus a
   separately preserved display form (`users.email_display`, migration `0030_email_display_form.sql`)
   survives signup and email-change (AUTH-IDENTITY-003). `tests/security-e2e/mfa-production-boundaries
   .spec.ts` fetches the real `/dashboard/security` HTTP response for a privileged account and scans it
   against that account's real Postgres secret values, and in doing so found and fixed a real production
   defect: the root layout's SWR fallback embedded the entire unminimized `getUser()` row -- including
   `passwordHash` -- into every authenticated page's initial HTML response; both it and `/api/user` now go
   through the new minimized `getPublicUser()` (AUTH-API-003). `lib/observability/security-events.ts`
   introduces a closed, compile-time-enforced security-event taxonomy (`logWarn`/`logError`'s `event`
   parameter is typed from the registry's own keys) with auto-attached category/resource/retention-class,
   proven in `tests/security-event-taxonomy.integration.ts` and `tests/security-event-log-attribution
   .integration.ts` (AUTH-LOG-001); the same logger now structurally minimizes metadata (flat primitives
   only, size/count-capped) rather than relying on caller discipline, and each event carries a declared
   retention class documented in docs/07 (AUTH-LOG-003). `lib/membership/exports.ts`'s `EXPORT_ROW_LIMIT`
   bounds the three temporally-growing admin exports (audit log, payments, notifications) at the most
   recent 25,000 rows, proven against real bulk-inserted volume in `tests/exports.integration.ts`; the
   absence of any analytics/tracking integration is now a tested fact, not an unverified impression
   (`tests/privacy-data-minimization.test.ts`) (AUTH-PRIVACY-001).
7. **Operations and observability — AUTH-ERROR-001, AUTH-EMAIL-002, AUTH-OPERATIONS-004,
   AUTH-OPERATIONS-006, AUTH-OPERATIONS-007. Slice 7 (this pull request): all five controls verified.**
   TEST and CODE+TEST. `tests/auth-error-classes.integration.ts` drives the real production `verifyLoginOtp`
   Server Action through both response classes: a genuinely persistent system failure (a `migrated_pending`
   account with no imported foundation record) surfaces the canonical generic support message, while an
   ordinary wrong-code mistake keeps its specific, actionable message (AUTH-ERROR-001).
   `tests/auth-email-resend-safety.integration.ts` drives the real production `resendSignupOtp`/
   `verifySignupOtp` Server Actions, proving the resend cooldown is enforced, a resent code actually
   supersedes (invalidates) the one it replaces, and the response shape never varies with whether the
   pending address already belongs to an existing account (AUTH-EMAIL-002). A new `mfa_replay_detected`
   security-event kind (migration `0031_mfa_replay_notification_kind.sql`) is now enqueued from both
   `verifyLoginTotp` (on a genuine TOTP counter replay, proven end to end in
   `tests/mfa-replay-notifications.integration.ts` against real Postgres across two independent login
   challenges) and `verifyLoginWebAuthn` (on the store-proven WebAuthn signCount-replay signal); the
   `production-mfa-finalization.integration.ts` suite was extended to assert the real
   `authenticator_enrolled`/`authenticator_replaced`/`recovery_code_used` notification rows the production
   finalizers write (AUTH-OPERATIONS-004). `lib/notifications/rate-limit-correlation.ts` correlates
   repeated rate-limit exceedances of the same bucket across multiple 15-minute windows into one
   severity-tagged operator alert once 3 of the last 4 windows were blocked, proven in
   `tests/rate-limit-correlation.integration.ts` against the real production `checkRateLimit` (AUTH-
   OPERATIONS-006). `lib/membership/incident-response.ts`'s `forceRevokeAllAuthority` is a new
   Super-Admin-gated, incident-correlated admin action (wired to a real Server Action and `/admin/members`
   form) that cuts every session, trusted device, and MFA factor for a target user in one call, proven in
   `tests/incident-response.integration.ts` against real Postgres including the authorization boundary and
   self-target rejection (AUTH-OPERATIONS-007).
8. **Deployment readiness and operational validation — AUTH-OPERATIONS-008, AUTH-OPERATIONS-010,
   AUTH-OPERATIONS-011. Slice 8 (this pull request): AUTH-OPERATIONS-010 verified; the
   repository-addressable half of AUTH-OPERATIONS-008 and AUTH-OPERATIONS-011 closed (both remain
   `partial`, gated on external/operational evidence).** CODE+TEST plus OPERATIONS/EXTERNAL-MANUAL.
   `lib/observability/clock-skew-check.ts` (new) compares the application server's own clock against
   Postgres's independent `now()` and pages an operator on drift beyond 5 seconds, wired to a scheduled
   cron route, proven in `tests/clock-skew-check.integration.ts` (AUTH-OPERATIONS-008's repository
   half). `scripts/validate-auth-docs.mjs` (existed since Slice 3 but was never actually run in CI) and
   a new `scripts/check-whitespace.mjs` are now real, enforced steps in both CI workflows
   (AUTH-OPERATIONS-010, now fully verified). `docs/25-release-readiness-checklist.json` (new) is a
   machine-readable mirror of docs/07 §15.6, CI-integrity-enforced against drift and against
   evidence-free self-certification by `scripts/validate-release-checklist.mjs`, proven in
   `tests/validate-release-checklist.test.ts` (AUTH-OPERATIONS-011's repository half). External
   validation still needs to record the restore drill, deployed configuration validation, provider
   test, reconciliation, and incident exercise, plus dated operator confirmation that the clock-skew
   cron fires in production and a real, evidence-backed completion of the release-readiness checklist
   for an actual release. Migration: no expected. External provider: yes for the final validation
   portion (Render, Vercel, Mandrill/Mailchimp). Acceptance: both the repository gaps and the dated
   operator evidence are closed; neither code/CI alone nor manual evidence alone is sufficient.

## External and operational evidence register

These items remain separate from repository-automated verification:

- **Production residual data:** run read-only `select count(*) from idoc.team_members` and `select
  count(*) from idoc.activity_logs where ip_address is not null`. Non-zero results require a retention,
  purpose, and notification assessment. Repository removal of writers cannot prove production row counts.
- **Render restore drill:** docs/07 documents the procedure, but no evidence establishes that a real restore,
  authentication-key rotation, and suspension/deletion/role reconciliation drill has occurred.
- **Mandrill webhook:** repository tests prove IDOC signature and route behavior; a dated live Mandrill test
  webhook is still provider/deployment evidence.
- **Production configuration:** validate—not infer—`SUPPORT_EMAIL`,
  `MAILCHIMP_TRANSACTIONAL_WEBHOOK_KEY`, remembered-TOTP enablement/days/digest key, `AUTH_SECRET`, MFA
  encryption keys, cron secrets, Google OIDC values, and administrator notification destinations in the
  deployed environment. Never record secret values in evidence.

## Maintenance rule

Update documents 22 and 23 atomically whenever a control changes status. Recount unique expanded IDs and
assert that `verified + implemented-but-unverified + partial + missing + not-applicable = 155` and that
this backlog contains exactly the same canonical IDs and classifications as the applicable
`implemented-but-unverified + partial + missing` rows in document 22. Historical changelog prose may
remain only when explicitly labeled historical.
