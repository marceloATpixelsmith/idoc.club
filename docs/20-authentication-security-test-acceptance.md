# Authentication security test acceptance

## Purpose and layers

`pnpm test:security` is the automated authentication and account-security acceptance gate. It first runs the existing isolated-PostgreSQL integration suites, which cover OTP digesting, purpose binding, exhaustion and expiry; password policy and reset invalidation; persisted-session replay and revocation; ownership checks; role transitions; Google transaction ownership and replay; MFA recovery, replacement and step-up; rate limiting; enumeration timing; and secret-free audit evidence.

Playwright then exercises the HTTP/browser boundary in Chromium. Its focused specifications prove anonymous denial, direct-request role and account-state enforcement, onboarding and expired-account routing, pending-cookie/session separation, real registry-backed session recognition, development cookie attributes, and response security headers. Deterministic synthetic fixtures include two active members, onboarding, expired, suspended, Administrator, and Super Administrator identities. They are created directly in the isolated database; no public test endpoint, authentication bypass, email delivery, Google request, Turnstile request, or production secret is used.

Playwright intentionally does not reproduce database concurrency, high-count abuse limits, cryptographic OTP/TOTP/recovery invariants, or provider callback internals when integration tests prove those properties more deterministically. Billing and payment security is excluded except for authorization boundaries.

## Running locally

1. Supply a PostgreSQL URL whose database name unmistakably contains `test` in `TEST_DATABASE_URL`; the guard rejects missing, ambiguous, production-equivalent, or non-PostgreSQL targets.
2. Install Chromium once with `pnpm exec playwright install chromium`.
3. Run `pnpm test:security`. Playwright starts and stops the application on port 3100, recreates only the `idoc` schema in the guarded database, and uses synthetic secrets.

Never target a shared developer or production database. Fixture reset is destructive within the test database's `idoc` schema. Generated storage states and traces are ignored by Git.

## Continuous integration and evidence

The dedicated workflow provisions PostgreSQL 16, installs Chromium, runs the complete command, and fails on any failed assertion. Compact output is retained normally; reports, traces, screenshots, and video are uploaded for seven days only after failure.

## Independent assurance still required

Automation is not penetration-test certification. Independent review remains required for deployed CDN/Vercel configuration, real provider and DNS behavior, secret rotation and incident response, social engineering and credential stuffing at realistic scale, browsers outside Chromium, dependency/infrastructure compromise, and novel chained business-logic attacks. Payment/subscription abuse remains a separate future suite.
