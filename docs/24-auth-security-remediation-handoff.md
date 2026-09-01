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

The remediation program tracks **155 canonical AUTH controls**. After completion of Slices 1 and 2, the repository baseline is:

- **120 verified**
- **14 implemented-but-unverified**
- **14 partial**
- **0 missing**
- **7 not-applicable**
- **28 applicable non-verified controls remaining**

Slices 1 and 2 are complete. Do not reopen completed controls merely to refactor them. Reopen only if current `main` contains a real regression or the canonical reference changed.

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

### Slice 3 — Authorization and privilege

Controls:

- `AUTH-STORAGE-002`
- `AUTH-LIFECYCLE-002`
- `AUTH-PASSWORD-005`
- `AUTH-IDENTITY-005`
- `AUTH-AUTHZ-005`
- `AUTH-API-004`

Goal: prove server-side authorization, lifecycle rejection, fresh verification/session rotation for password changes, collision-safe external-identity linking, and protected API/data boundaries through real production paths. Direct cross-account and disallowed-lifecycle requests must fail closed without unauthorized mutation or protected-resource disclosure.

### Slice 4 — CSRF / request integrity

Control:

- `AUTH-CSRF-003`

Goal: implement and behaviorally prove the canonical token-based CSRF property where it applies: unpredictable purpose/session-bound tokens, server validation, expiry/rotation, and rejection of missing, replayed, and cross-session submissions. Preserve Origin validation as defense in depth. This is a current application-code readiness blocker.

### Slice 5 — Credential and key lifecycle

Controls:

- `AUTH-STORAGE-005`
- `AUTH-STORAGE-006`
- `AUTH-CRYPTO-003`
- `AUTH-OPERATIONS-005`
- `AUTH-SECRET-001`
- `AUTH-CRYPTO-004`
- `AUTH-SECRET-004`
- `AUTH-DEPENDENCY-001`

Goal: behaviorally prove password-hash upgrade, MFA-secret confidentiality, secret-free security events, key/JWKS/secret rotation and separation, build-output exclusion, and intentional fail-open/fail-closed behavior for security dependencies. Implement missing lifecycle properties where the evidence matrix marks them partial.

### Slice 6 — Privacy and logging

Controls:

- `AUTH-IDENTITY-003`
- `AUTH-API-003`
- `AUTH-LOG-001`
- `AUTH-LOG-003`
- `AUTH-PRIVACY-001`

Goal: prove canonical identity normalization/display semantics, minimized response surfaces, safe structured security logging, and enforceable privacy/retention boundaries without leaking MFA or authentication secret material.

### Slice 7 — Operations and observability

Controls:

- `AUTH-ERROR-001`
- `AUTH-EMAIL-002`
- `AUTH-OPERATIONS-004`
- `AUTH-OPERATIONS-006`
- `AUTH-OPERATIONS-007`

Goal: prove stable generic authentication errors, email-verification resend/supersession behavior, actionable secret-free security events, severity/ownership, and the remaining alert-correlation/anomaly-response requirements.

### Slice 8 — Deployment readiness and operational validation

Controls:

- `AUTH-OPERATIONS-008`
- `AUTH-OPERATIONS-010`
- `AUTH-OPERATIONS-011`

Goal: close both the repository-addressable gaps and the external/manual evidence requirements for these controls. Specifically, implement and verify the missing clock-skew monitoring/alerting called out by `AUTH-OPERATIONS-008`; add the missing CI lint/format and auth-contract documentation-drift checks called out by `AUTH-OPERATIONS-010`; and add the machine-readable readiness/checklist freshness enforcement required by `AUTH-OPERATIONS-011`. After those repository gaps are closed, obtain dated operational evidence for the real deployed environment, restore/reconciliation drills, provider validation, and incident readiness. Do not promote these controls from code/CI alone or from manual evidence alone when the authoritative row requires both.

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

When this file is used as a handoff, begin with **Slice 3 — Authorization and privilege** unless current `docs/22`/`docs/23` show that it has already been completed. Inspect current `main` first; never assume the status in this handoff is newer than the authoritative matrix/backlog.