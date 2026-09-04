# 24. Authentication and Security Remediation Handoff

## Purpose

This document is the repository-native continuation point for the remaining canonical authentication and security remediation program. It is written so a fresh Claude Code session can resume from current `main` without relying on prior chat history.

Do not treat this document as a replacement for the evidence matrix or backlog. The authoritative sources are:

- `AGENTS.md`
- `docs/05-security-and-privacy-requirements.md`
- `docs/08-product-roadmap-and-functional-requirements.md`
- `docs/09-codex-working-rules.md` for repository/PR discipline unless a task-specific Claude instruction is stricter
- `docs/20-authentication-security-test-acceptance.md`
- `docs/21-authentication-security-control-inventory.md`
- `docs/22-canonical-auth-evidence-matrix.md` — authoritative per-control status/evidence
- `docs/23-auth-security-remediation-backlog.md` — authoritative remaining backlog and slice grouping
- the current machine-readable contract in `marceloATpixelsmith/pixelsmith-auth-reference` — read-only reference

## Current baseline

The remediation program tracks **155 canonical AUTH controls**. As of the corrective-audit continuation below, the repository baseline is:

- **145 verified**
- **0 implemented-but-unverified**
- **3 partial**
- **0 missing**
- **7 not-applicable**
- **3 applicable non-verified controls remaining**

This baseline is stated authoritatively by `docs/23`'s counting-method paragraph and enforced by `node scripts/validate-auth-docs.mjs`; if the two ever disagree, `docs/23`/`docs/22` win and this section is stale. The three remaining `partial` controls are `AUTH-SECRET-004` (from Slice 5, narrowed but not closed), and `AUTH-OPERATIONS-008`/`AUTH-OPERATIONS-011` (both from Slice 8, repository half complete, gated exclusively on external/operational evidence this repository cannot produce on its own) — see each control's docs/23 row for the precise remaining gap. Do not reopen completed controls merely to refactor them. Reopen only if current `main` contains a real regression, the canonical reference changed, or a genuine audit finding identifies a real evidence gap.

## Definition of VERIFIED

A control is `verified` only when real behavioral evidence exercises the actual production code path and observes the required result. Depending on the control, acceptable evidence may require real Postgres, signed cookies/JWTs, the real Server Action/route/function, or Chromium/Playwright.

The following are not sufficient by themselves for promotion to `verified`:

- source or regex inspection
- unit-testing a parallel helper that production does not call
- manually constructing a cookie/token instead of exercising the issuer
- asserting only a happy path where the canonical control requires denial, replay, expiry, concurrency, cross-user, cross-session, or stale-state behavior
- claiming a test passed when it was not actually run

When a required behavioral test cannot run in the local Claude environment, implement it correctly, leave the control open until CI proves it, and report the limitation precisely.

## Remaining remediation slices

### Slice 3 — Authorization and privilege (COMPLETE)

Controls (all now `verified`):

- `AUTH-STORAGE-002`
- `AUTH-LIFECYCLE-002`
- `AUTH-PASSWORD-005`
- `AUTH-IDENTITY-005`
- `AUTH-AUTHZ-005`
- `AUTH-API-004`

Goal (met): prove server-side authorization, lifecycle rejection, fresh verification/session rotation for password changes, collision-safe external-identity linking, and protected API/data boundaries through real production paths. Direct cross-account and disallowed-lifecycle requests fail closed without unauthorized mutation or protected-resource disclosure, proven in `tests/authorization-privilege-boundaries.integration.ts`, `tests/role-grants.integration.ts`, and `tests/security-e2e/api-authorization-disclosure.spec.ts`. This slice also found and fixed a real production defect: the Google-identity-linking audit-log write passed untyped bind parameters into `jsonb_build_object(...)`, which real PostgreSQL rejects — linking/unlinking a Google identity would have thrown in production the first time either path actually ran.

### Slice 4 — CSRF / request integrity (COMPLETE)

Control (now `verified`):

- `AUTH-CSRF-003`

Goal (met): implemented and behaviorally proved the canonical token-based CSRF property: a signed, expiring (4-hour), session-bound double-submit-cookie token (`lib/security/csrf-tokens.ts`, `lib/security/csrf.ts`), issued/rotated at `setSession()`/`clearSession()`, enforced on every mutating Server Action, and proven with real-browser tests in `tests/security-e2e/csrf.spec.ts` (tampered form field, removed cookie) plus the existing real-Postgres adversarial suites, which now thread real production-issued tokens through every `validatedAction` call they exercise. Origin validation (AUTH-CSRF-001) is preserved as defense in depth. This slice also found and fixed a real production defect: an attempt to preserve the root layout's Partial Prerendering static shell by moving the CSRF-cookie read behind a Suspense boundary silently degraded a deep `redirect()` call (e.g. an anonymous visitor's `/admin` authorization check) from a real HTTP 3xx into a client-JS-only redirect — confirmed with a real dev-server request returning HTTP 200 instead of a redirect. Fixed by keeping that read synchronous and unwrapped, trading away the (experimental, opt-in) PPR static shell app-wide for guaranteed-correct authorization/CSRF behavior on every request.

### Slice 5 — Credential and key lifecycle (COMPLETE, one control left narrowed but open)

Controls (all now `verified` except as noted):

- `AUTH-STORAGE-005`
- `AUTH-STORAGE-006`
- `AUTH-CRYPTO-003`
- `AUTH-OPERATIONS-005`
- `AUTH-SECRET-001`
- `AUTH-CRYPTO-004`
- `AUTH-SECRET-004` (still `partial` — see below)
- `AUTH-DEPENDENCY-001`

Goal (met for seven of eight): behaviorally proved password-hash upgrade (`tests/password-hash-migration.integration.ts`, real Postgres, real `signIn`), MFA-secret/recovery-code confidentiality across a real enrollment/recovery/replacement/acknowledgement cycle (`tests/auth-recovery-adversarial.integration.ts`), a real forced JWKS-outage-during-unknown-key-refresh fail-closed proof (`tests/security-e2e/google-oauth.spec.ts`), Google OAuth client secret exclusion from real build output (`tests/build-runtime-boundary.build.ts`), an explicit MFA key lifecycle state model derived from real database usage (`lib/auth/mfa/key-lifecycle.ts`, `tests/totp-key-ring.integration.ts`), and an explicit, code-level dependency risk register held against real forced-failure behavior (`lib/security/dependency-risk-register.ts`, `tests/dependency-risk-register.test.ts`). `AUTH-SECRET-004` also has a permanent Super Admin production operation at `/admin/security`, with CSRF, fresh MFA, server-selected configuration, secret-free persistence, and concurrent/retry idempotency. It remains `partial` only until that deployed operation records and confirms the already-completed real production rotation.

### Slice 6 — Privacy and logging (COMPLETE)

Controls (all five verified):

- `AUTH-IDENTITY-003`
- `AUTH-API-003`
- `AUTH-LOG-001`
- `AUTH-LOG-003`
- `AUTH-PRIVACY-001`

Goal (met): behaviorally proved NFC-normalized deterministic case-insensitive identity plus a separately preserved display form through the real signup/email-change paths (`tests/email-identity-normalization.integration.ts`, `tests/email-change.integration.ts`); a real, minimized-response behavioral test for the MFA security page that found and fixed a genuine production secret leak (the root layout's SWR fallback embedded the full `getUser()` row, including `passwordHash`, into every authenticated page's RSC payload -- see `lib/db/queries.ts`'s `getPublicUser()` and `tests/security-e2e/mfa-production-boundaries.spec.ts`); a closed, compile-time-enforced security-event taxonomy with auto-attached category/resource/retention-class and structural metadata minimization (`lib/observability/security-events.ts`, `lib/observability/logger.ts`, `tests/security-event-taxonomy.integration.ts`, `tests/security-event-log-attribution.integration.ts`); and a bounded row cap on the temporally-growing admin exports plus a tested absence of any analytics integration (`lib/membership/exports.ts`, `tests/exports.integration.ts`, `tests/privacy-data-minimization.test.ts`).

### Slice 7 — Operations and observability (COMPLETE)

Controls (all five verified):

- `AUTH-ERROR-001`
- `AUTH-EMAIL-002`
- `AUTH-OPERATIONS-004`
- `AUTH-OPERATIONS-006`
- `AUTH-OPERATIONS-007`

Goal (met): `tests/auth-error-classes.integration.ts` behaviorally proves the real production `verifyLoginOtp` surfaces the canonical generic support message only for a genuinely persistent failure (a `migrated_pending` account with no imported foundation record), keeping ordinary mistakes specific; `tests/auth-email-resend-safety.integration.ts` proves the real production `resendSignupOtp`/`verifySignupOtp` enforce the cooldown, genuinely supersede a prior code, and stay enumeration-resistant. A new `mfa_replay_detected` security-event kind (migration `0031_mfa_replay_notification_kind.sql`) closes the "replay attempts have no dedicated security event" gap, wired into both `verifyLoginTotp` and `verifyLoginWebAuthn` in `app/(login)/mfa/actions.ts` and proven end to end for the TOTP path in `tests/mfa-replay-notifications.integration.ts`; `production-mfa-finalization.integration.ts` was extended to assert the real enrollment/replacement/recovery notification kinds too. `lib/notifications/rate-limit-correlation.ts` adds a real, narrow correlation engine (3-of-4-window sustained blocking of the same bucket pages an operator once, severity-tagged) proven in `tests/rate-limit-correlation.integration.ts`. `lib/membership/incident-response.ts`'s `forceRevokeAllAuthority` adds the previously-missing operator-initiated "force-revoke all authority for user X" admin tool (Super-Admin-gated, incident-correlated audit trail, wired to a real Server Action and admin form), proven in `tests/incident-response.integration.ts`.

### Slice 8 — Deployment readiness and operational validation (REPOSITORY HALF COMPLETE)

Controls:

- `AUTH-OPERATIONS-008` (repository half complete, remains `partial` pending external evidence)
- `AUTH-OPERATIONS-010` (verified)
- `AUTH-OPERATIONS-011` (repository half complete, remains `partial` pending external evidence)

Goal (repository half met): `lib/observability/clock-skew-check.ts` (new) implements and behaviorally proves the clock-skew monitoring/alerting `AUTH-OPERATIONS-008` called out, wired to a scheduled cron route (`tests/clock-skew-check.integration.ts`). `scripts/validate-auth-docs.mjs` (existed since Slice 3, never wired into CI until now) and a new `scripts/check-whitespace.mjs` close and fully verify `AUTH-OPERATIONS-010` -- both are now real, enforced steps in both CI workflows. `docs/25-release-readiness-checklist.json` plus `scripts/validate-release-checklist.mjs` (new) implement the machine-readable readiness/checklist freshness and anti-self-certification enforcement `AUTH-OPERATIONS-011` called out (`tests/validate-release-checklist.test.ts`). What remains, for `AUTH-OPERATIONS-008` and `AUTH-OPERATIONS-011` only, is exclusively external/operational evidence this repository cannot produce on its own: dated operator confirmation that the deployed cron fires and pages on real drift, and a real, evidence-backed completion of the release-readiness checklist for an actual production release. Do not promote either of those two controls from code/CI alone; their authoritative rows require both halves closed.

## Required workflow for each remaining slice

1. Start from the latest available `main`.
2. Read the exact current rows for the target controls in `docs/22` and `docs/23` before coding. Do not rely on this handoff for row-level details if those documents changed.
3. Read the matching requirement(s) in `pixelsmith-auth-reference` and the directly related production code/tests.
4. Keep one remediation slice per feature branch/PR unless the user explicitly narrows it further.
5. Use a normal non-draft PR into `main`; never commit directly to `main`; do not merge the PR yourself unless explicitly instructed.
6. Fix production defects exposed by behavioral testing narrowly; do not weaken the canonical security contract to make tests pass.
7. Update governing docs in the same PR when behavior changes.
8. Promote a control in `docs/22` and remove/update its `docs/23` backlog row only after the required evidence actually passes.
9. Update `docs/22` and `docs/23` atomically. Recalculate counts; never hand-edit summary totals without reconciling the row-level statuses.
10. Run `node scripts/validate-auth-docs.mjs` whenever docs 22/23 change.
11. Stop after opening the coherent PR and triggering CI. Routine CI failures and review comments are handled by the client/ChatGPT workflow unless the user explicitly asks Claude to continue.

## Validation expectations

Run all applicable checks that exist on the current branch, including:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:ci
pnpm test:integration-db
pnpm test:security-e2e
pnpm test:security
pnpm test:build-boundary
node scripts/validate-auth-docs.mjs
pnpm build
pnpm check:release1
```

Also follow any newer commands required by `AGENTS.md`, `docs/09-codex-working-rules.md`, package scripts, or the current CI workflows. Do not claim unavailable checks passed.

## Operational evidence that repository work cannot self-certify

Slice 8 is a mixed closure boundary: its repository-addressable gaps must be implemented and tested first, but repository work still cannot self-certify the deployed/manual portion. Before any final production-readiness claim, explicitly complete or obtain operator evidence for all items still listed in the `docs/23` external/operational register, including at minimum:

- read-only production residual-data checks for historical `idoc.team_members` rows and non-null `idoc.activity_logs.ip_address` rows, with retention/purpose/notification assessment if non-zero
- a real Render/Postgres restore drill followed by authentication-key rotation and suspension/deletion/role reconciliation checks
- a dated live Mandrill/Mailchimp Transactional webhook/provider validation
- deployed Vercel/Render configuration validation for security-sensitive environment variables and administrator notification destinations without recording secret values
- any machine-readable release/incident evidence required to close `AUTH-OPERATIONS-010` and `AUTH-OPERATIONS-011`

## Finish condition

Do not declare IDOC production ready merely because all planned implementation PRs merged. When all repository-addressable backlog rows are closed:

1. run a fresh, from-scratch audit of the proposed final `main` against the current canonical `pixelsmith-auth-reference` contract;
2. reconcile docs 22 and 23 against that audit;
3. complete the external/manual production validation in Slice 8;
4. only then issue the final verdict: either **not ready**, with exact blockers, or **ready for application-specific production launch**, with the dated evidence supporting that conclusion.

## Continuation instruction for Claude

Slice 8 — Deployment readiness and operational validation is repository-complete as of this revision: every gap this ordered remediation-slice list named has been implemented and behaviorally proven in the repository. Three controls remain `partial`, each gated exclusively on external/operational evidence no repository session can produce on its own: `AUTH-SECRET-004` (from Slice 5), and `AUTH-OPERATIONS-008`/`AUTH-OPERATIONS-011` (from Slice 8) — see each control's docs/23 row for the precise remaining gap. When this file is used as a handoff, there is no next numbered slice to start; inspect current `main`, `docs/22`, and `docs/23` first to confirm this baseline still holds (a regression or a canonical-reference change could reopen a control), and if a Codex review or the user identifies further real gaps, treat those as their own scoped follow-up rather than assuming another slice is pending. Obtaining the three controls' external/operational evidence (a real deployed clock-skew alert, a real completed release-readiness checklist, a real recorded OAuth-secret-rotation event) is an operator/deployment action, not further repository code.

## Corrective audit continuation (2026-09-03)

A fresh corrective audit rejected source/regex-only evidence as behavioral verification and reopened
`AUTH-CRYPTO-003`, `AUTH-PRIVACY-001`, `AUTH-DEPENDENCY-001`, `AUTH-OPERATIONS-004`,
`AUTH-OPERATIONS-006`, and `AUTH-OPERATIONS-007` as `partial`; their precise missing evidence is restored
to docs/23. `AUTH-LOG-001` and `AUTH-LOG-003` were remediated with a runtime, event-specific metadata
allowlist and attribution boundary plus adversarial tests against the production logger. The canonical
baseline recorded by the attached checkout has contract `2.0.0`, machine schema `14.0.0`, validator
`11.0.0`, mapping schema `1.0.0`, and portable-config schema `2.0.0`. The checkout does not record the
canonical Git commit and no reference checkout is attached; outbound GitHub access was unavailable
during this pass, so the exact reference commit remains unverified and maintainers must confirm freshness
and GitHub ruleset/review-gate state before merge. The application is not production-ready.

## Corrective audit continuation (2026-09-03, second pass)

A further pull request closed three of the six controls the corrective audit above reopened, with real
behavioral evidence in place of the prior source-inspection-only proof:

- **`AUTH-DEPENDENCY-001`** — `tests/dependency-risk-register-forced-failure.integration.ts` (new, real
  Postgres) makes the real production database connection genuinely unreachable before driving the real
  production `checkRateLimit`/`requireAccountAccess` through it, proving each rejects rather than falling
  back to "allowed"/"granted". `tests/stripe-webhook.integration.ts` gained a test that forces the one
  real outbound Stripe API call `processStripeEvent` makes to genuinely fail and proves the whole event
  — including its own dedup-flag row — rolls back atomically.
- **`AUTH-OPERATIONS-006`** — the rate-limit correlation alert's email send, previously awaited directly
  inside `checkRateLimit` (the authentication-adjacent hot path every sign-in/sign-up/password-reset
  request runs through) with no durable retry, now enqueues into a new `idoc.operational_alert_outbox`
  table and is delivered by a leased, retrying worker (`lib/notifications/operational-alert-outbox.ts`/
  `operational-alert-delivery.ts`, migration `0033`) mirroring the already-proven
  `auth_security_notification_outbox` pattern — proven in `tests/rate-limit-correlation.integration.ts`.
- **`AUTH-OPERATIONS-007`** — `forceRevokeAllAuthority` gained a DB-enforced idempotency guarantee
  (`audit_log_force_revoke_incident_unique`, migration `0034` — a retry with the same `incidentReference`
  now never re-bumps `session_version`, re-revokes, or re-notifies), a durable operations-team alert (via
  the outbox built for AUTH-OPERATIONS-006), and new adversarial tests in
  `tests/incident-response.integration.ts` proving true idempotency, safe concurrent-race behavior, that a
  pending MFA login challenge captured before revocation fails afterward via `session_version`
  invalidation (driven through the real `beginPrimaryMfa`/`verifyLoginTotp`), and idempotent recovery from
  a simulated partial-completion crash.

A fourth control from that same corrective audit was also closed in this pass:

- **`AUTH-PRIVACY-001`** — the analytics-absence scan previously covered only `app/layout.tsx`;
  `tests/privacy-data-minimization.test.ts` now scans every production source file under `app/` and
  `lib/` (plus `middleware.ts`/`next.config.ts`), and `tests/build-runtime-boundary.build.ts`
  additionally scans the real production build's browser-visible output for the same patterns.
  `tests/exports.integration.ts` gained route-level cross-user-rejection tests for the members and
  notifications export routes (previously only the library-function level was tested for members, and
  the notifications route had no test at all), plus real CSV-body content assertions for the
  payments/notifications routes.

## Corrective audit continuation (2026-09-03, third pass)

A further pull request closed the two remaining reopened controls from the first corrective-audit pass,
with real behavioral evidence in place of source-inspection-only proof:

- **`AUTH-CRYPTO-003`** — `passkey_registered`/`passkey_removed`'s secret-absence claim was previously
  confirmed only by direct code reading (no comparable secret exists by WebAuthn's own asymmetric
  design), not a dedicated scan. `tests/webauthn-ceremony-simulator.ts` (new) is a real, minimal
  WebAuthn authenticator -- a genuine ES256 (P-256) keypair via Node's own WebCrypto, real
  CBOR-encoded ("none" attestation) registration material, and a real DER-encoded ECDSA-signed
  authentication assertion -- built by reusing `@simplewebauthn/server`'s own public `/helpers`
  subpath export (isoCBOR, isoBase64URL, the COSE constants) so its encoding is guaranteed
  byte-compatible with what the real verifier decodes. `tests/webauthn-mfa-adversarial.integration.ts`
  (new) drives a real registration and a real removal through the real production
  `finishPasskeyRegistration`/`removePasskeyCredential` Server Actions and scans the resulting
  audit/notification evidence for the raw public-key material, finding none.
- **`AUTH-OPERATIONS-004`** — fully closed. `tests/webauthn-mfa-adversarial.integration.ts` now uses
  the real WebAuthn ceremony simulator, real production Server Actions, and real Postgres while a
  bounded test-only barrier holds two genuine verifier calls after both read the same stale counter.
  The deterministic race proves exactly one session transition, one generic replay result, one durable
  `mfa_replay_detected` event, the correct stored sign counter, and no credential, assertion, challenge,
  session, or public-key material in evidence or client results.

`docs/22` and `docs/23` were updated to match (`node scripts/validate-auth-docs.mjs` passes: 145
verified, 3 partial). The application is still not production-ready; the same reference-commit-freshness
and GitHub ruleset/review-gate caveats from the passes above still apply.
