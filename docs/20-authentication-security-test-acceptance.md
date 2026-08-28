# Authentication security test acceptance

## Purpose and layers

`pnpm test:security` is the automated authentication and account-security acceptance gate. It first runs the existing isolated-PostgreSQL integration suites, which cover OTP digesting, purpose binding, exhaustion and expiry; password policy and reset invalidation; persisted-session replay and revocation; ownership checks; role transitions; Google transaction ownership and replay; MFA recovery, replacement and step-up; rate limiting; enumeration timing; and secret-free audit evidence.

Playwright then exercises the HTTP/browser boundary in Chromium. Its focused specifications prove anonymous denial, direct-request role and account-state enforcement, onboarding and expired-account routing, pending-cookie/session separation, real registry-backed session recognition, development cookie attributes, and response security headers. Deterministic synthetic fixtures include two active members, onboarding, expired, suspended, Administrator, and Super Administrator identities. They are created directly in the isolated database; no public test endpoint, authentication bypass, email delivery, Google request, Turnstile request, or production secret is used.

Playwright intentionally does not reproduce database concurrency, high-count abuse limits, cryptographic OTP/TOTP/recovery invariants, or provider callback internals when integration tests prove those properties more deterministically. Billing and payment security is excluded except for authorization boundaries.

[Authentication & account-security control inventory](21-authentication-security-control-inventory.md) is the control-by-control map behind this gate: for every implemented authentication/authorization/session/MFA/OAuth/CSRF/rate-limit/account-state/cookie/header control it records the exact code and database location, the exact test file (if any) and whether that test is behavioral (executes the code) or source-inspection (asserts the code's shape by pattern), and whether the control is proven end-to-end by this repository's own suite, proven only by source inspection, or not yet covered at all. Document 21 §9 is the authoritative list of behaviors that are implemented but currently only source-inspection-verified or entirely untested — for example, idle/absolute session timeout is enforced in code but not proven by a clock-advanced behavioral test, and OAuth state replay/purpose-mismatch rejection is enforced in code but not exercised by a live replayed request. Document 21 §7.1–§7.3 and §12 record the small number of behaviors that are genuinely not yet implemented at all (no application-level CSRF token beyond the Next.js Server Action origin check; no application-level HSTS header; the legacy token/link account-recovery path's rate limiting has not been migrated to the dual-bucket design used elsewhere) — these are gaps, not test-coverage omissions, and are not represented as passing anywhere in this repository's test output.

## Running locally

1. Supply a PostgreSQL URL whose database name unmistakably contains `test` in `TEST_DATABASE_URL`; the guard rejects missing, ambiguous, production-equivalent, or non-PostgreSQL targets.
2. Install Chromium once with `pnpm exec playwright install chromium`.
3. Run `pnpm test:security`. Playwright starts and stops the application on port 3100, recreates only the `idoc` schema in the guarded database, and uses synthetic secrets.

Never target a shared developer or production database. Fixture reset is destructive within the test database's `idoc` schema. Generated storage states and traces are ignored by Git.

## Continuous integration and evidence

The dedicated workflow provisions PostgreSQL 16, installs Chromium, runs the complete command, and fails on any failed assertion. Compact output is retained normally; reports, traces, screenshots, and video are uploaded for seven days only after failure.

## Independent assurance still required

Automation is not penetration-test certification. Independent review remains required for deployed CDN/Vercel configuration, real provider and DNS behavior, secret rotation and incident response, social engineering and credential stuffing at realistic scale, browsers outside Chromium, dependency/infrastructure compromise, and novel chained business-logic attacks. Payment/subscription abuse remains a separate future suite.
