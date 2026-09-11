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

STRIPE_E2E_ENABLED=true is explicit opt-in. The validator must fail when required Stripe
configuration is missing or when the browser suite is pointed at live mode. Live credentials must
never be placed in CI. A run without opt-in test-mode evidence is incomplete for production launch.

Before live enablement, an administrator must verify in the Stripe Dashboard test account that the
configured webhook endpoint subscribes to the event list in docs/04, retries deliver idempotently,
Customer Portal settings match policy, and restricted-key/secret rotation has been tested. Record
evidence in the release checklist; do not paste secrets or payment details.

## Gaps deliberately not hidden

Provider-backed browser evidence cannot honestly be claimed by ordinary CI without disposable Stripe
test credentials and a reachable app/database. The release gate distinguishes automated repository
checks, opt-in Stripe test-mode browser evidence, and manual Dashboard/deployment evidence. A green
ordinary CI run is not a substitute for the latter two.
