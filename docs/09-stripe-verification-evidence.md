# Stripe verification evidence

This document is the release evidence contract for Stripe-backed flows. Unit tests and webhook
integration tests prove server behavior; they do not prove a real browser/provider round trip.

## Required test-mode browser scenarios

1. Membership one-time Checkout: EUR 80, successful return, verified webhook, entitlement granted once.
2. Membership subscription Checkout: EUR 80 recurring Checkout, verified webhook, entitlement granted once.
3. Customer Portal: member opens the server-created portal session and cannot supply another member's Customer ID.
4. Failed renewal: failed invoice is recorded, grace starts once, notices are bounded, and access becomes payment-only after the exact grace window.
5. Seminar Checkout: two seminars with different prices produce isolated Checkout amounts; tampering with price or registration ID is rejected.
6. Seminar cancellation/refund: cancellation preserves payment evidence; an administrator may use the documented Stripe refund procedure and the local projection becomes canceled without changing another registration.
7. Browser resilience: refresh/back, double-click, session expiry, CSRF failure, unauthorized member access, and administrator-only refund/reconciliation access.

For each run retain the commit SHA, UTC timestamp, environment mode, database migration version,
Stripe test object IDs, webhook event IDs, Playwright report/trace on failure, and the final local
projection. Never retain card numbers, secret keys, webhook secrets, or full request headers.

## Execution contract

`STRIPE_E2E_ENABLED=true` is explicit opt-in. Install the repository's pinned dependencies, provide
an unmistakably test-only `TEST_DATABASE_URL`, the four canonical payment variables, and a reachable
test application URL, then run:

```sh
STRIPE_E2E_ENABLED=true \
STRIPE_E2E_APP_URL=https://stripe-e2e.example.test \
TEST_DATABASE_URL=postgresql://.../idoc_test_stripe \
pnpm test:stripe-e2e
```

`STRIPE_E2E_START_COMMAND` may name the command that starts that application; otherwise the runner
expects it to be running already. The dedicated configuration fails before tests when opt-in is
absent, canonical configuration is missing/malformed, a live key is supplied, the database name is
not unmistakably test-only, the Product cannot be retrieved in test mode, or the application is not
reachable. It uses the installed `stripe` and `@playwright/test` versions; it never installs or pins a
second provider client. Live credentials must never be placed in CI. A run without opt-in test-mode
evidence is incomplete for production launch.

The fixture member address must match `stripe-e2e-<unique-run>@example.test`. Global setup destroys
and migrates only the validated disposable database, creates two independently owned test Customers,
and tags both provider objects with their fixture address. The readiness spec is a real, passing-only
provider check: it retrieves both Customers and the configured Product and verifies that every object
is test-mode. It is no longer a skipped placeholder and therefore cannot make an incomplete run look
accepted.

Before live enablement, an administrator must verify in the Stripe Dashboard test account that the
configured webhook endpoint subscribes to the event list in docs/04, retries deliver idempotently,
Customer Portal settings match policy, and restricted-key/secret rotation has been tested. Record
evidence in the release checklist; do not paste secrets or payment details.

## Gaps deliberately not hidden

Provider-backed browser evidence cannot honestly be claimed by ordinary CI without disposable Stripe
test credentials and a reachable app/database. The release gate distinguishes automated repository
checks, opt-in Stripe test-mode browser evidence, and manual Dashboard/deployment evidence. A green
ordinary CI run is not a substitute for the latter two.

## Evidence ownership

Automatable evidence consists of repository unit tests, disposable-PostgreSQL integration tests,
security tests, opt-in Playwright test-mode flows, webhook replay/idempotency tests, canonical
configuration validation, migration/schema checks, build/release checks, and secret/log-safety
checks. These commands create artifacts only; they never mark the release checklist verified.

Manual-only evidence consists of Stripe Dashboard webhook-event configuration, restricted-key
permission confirmation, Customer Portal settings, Production Vercel environment and deployment,
production backup/restore, named operator approval, every live-mode payment test, and every artifact
that requires access to the owner's Stripe or Vercel accounts. The Stripe evidence checklist item
must remain unchecked until a real operator supplies structured, non-secret evidence.
