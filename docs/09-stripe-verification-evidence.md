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

Global setup writes a secret-free `run.json` into `STRIPE_E2E_EVIDENCE_DIR` containing the commit,
UTC start time, unique run ID, test mode, current migration, configured Product, and both independently
tagged Customer IDs. Scenario traces and assertions add the Checkout, SetupIntent, PaymentMethod,
Price, Schedule, subscription, invoice, refund, webhook-event, and final-projection evidence produced
by that same run; an artifact missing those scenario results is incomplete rather than a passing run.

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

## Executable acceptance-completeness gate

`pnpm validate:stripe-acceptance-inventory` reads `docs/27-stripe-payment-acceptance-gate.json` and fails when
one of the ten automatable requirement groups has no mapped executable test, a mapped file is
missing, a mapped test contains `skip`, `fixme`, `TODO`, or `FIXME`, or a mapped provider spec fails
to instantiate Stripe, inspect provider state, and prove `livemode=false`. It also rejects vague
manual-only entries. Both Fast PR verification and Release 1 verification run this inventory check.
It deliberately prints that it is not execution evidence. The actual completion gate is
`STRIPE_E2E_ENABLED=true pnpm test:stripe-acceptance`; it fails closed without opt-in and runs the
inventory check, all disposable-PostgreSQL integration tests, and the Stripe Playwright suite in
sequence. Only that successful command plus its dated Playwright/provider artifacts may support an
automated acceptance claim.

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

## Acceptance audit follow-up: scenario boundaries

The version 2 manifest maps stable requirement and scenario IDs to an **exact test title**, execution
class, and scenario-specific evidence anchors. The validator parses TypeScript test declarations and
requires assertions inside the mapped test body; it rejects absent files, duplicate IDs, skipped,
fixed, placeholder, or disabled tests, missing behavior anchors, fake-provider claims in provider
scenarios, and automated mappings on manual-only items. Its actionable diagnostic includes the
requirement ID, scenario ID, test path, missing behavior, and expected evidence. This remains an
inventory/traceability check: passing it says nothing about whether PostgreSQL, Playwright, or Stripe
ran.

### Executable locally

Disposable-PostgreSQL integration tests cover authoritative seminar pricing and ownership,
registration concurrency, webhook mismatch rejection and replay, refund authorization and exact
amounts, retained original payment evidence, provider-failure recovery, duplicate-refund prevention,
CSRF rejection, reconciliation authorization, test-database rejection, and live-key rejection.
Provider doubles in these tests deliberately prove application behavior only and are never described
as Stripe evidence.

### Executable with Stripe test mode

`tests/stripe-e2e/seminar-provider.acceptance.spec.ts` registers through the member UI, injects forged
client payment/ownership fields, retrieves the exact server-created Checkout Session from Stripe,
asserts its Customer, registration, profile, seminar, authoritative amount, EUR currency, and
`livemode=false`, then drives the production signature-verifying webhook endpoint. Mismatch events
run while the retrieved provider Session is unpaid, the completed provider Session credits exactly
once, and replay leaves the payment audit and membership entitlement unchanged. The provider refund
scenario uses the same authorized refund service called by the administrator Server Action, retrieves
the real Refund and PaymentIntent, verifies amount/currency/ownership metadata and test mode, checks
the canceled/refunded projection without changing membership, and proves a second attempt neither
calls Stripe nor duplicates evidence. Browser scenarios separately exercise member denial, the real
CSRF form boundary, expired sessions, double-click, refresh/back/forward, cross-member identifier
forgery and the administrator reconciliation page. Administrator refund CSRF and fresh-TOTP behavior
also remains executable in the local security/integration suites; the provider suite does not bypass
or weaken those boundaries.

The application re-retrieves a seminar Checkout Session from Stripe during verified webhook handling
and uses that response for payment, Customer, PaymentIntent, amount and currency decisions. A signed
event body cannot replace those provider-controlled fields. Test-created Customers carry `run_id` and
fixture metadata; seminar PaymentIntents and Refunds carry `testRun` equal to the unique
`stripe-e2e-...@example.test` fixture identity. IDs are generated per database reset/run, the suite is
single-worker, and stable idempotency keys are scoped to newly generated registration IDs. Concurrent
runs therefore require different disposable databases and fixture email values and cannot reuse a
Customer, Checkout Session, PaymentIntent, registration, or Refund identity.

### Provider execution safety and exact inputs

The complete provider command requires all of the following (values shown are shapes, not secrets):

```sh
NODE_ENV=test \
STRIPE_E2E_ENABLED=true \
STRIPE_E2E_APP_URL=https://reachable-test-host.example.test \
STRIPE_E2E_MEMBER_EMAIL=stripe-e2e-<unique-run>@example.test \
STRIPE_E2E_EVIDENCE_DIR=.stripe-e2e/evidence/<unique-run> \
TEST_DATABASE_URL=postgresql://.../idoc_stripe_e2e_<unique-run> \
POSTGRES_URL=postgresql://.../a-different-non-test-production-destination \
AUTH_SECRET=<test-only-at-least-32-byte-secret> \
BASE_URL=https://reachable-test-host.example.test \
STRIPE_SECRET_KEY=sk_test_... \
STRIPE_WEBHOOK_SECRET=whsec_... \
STRIPE_MEMBERSHIP_PRODUCT_ID=prod_... \
STRIPE_MEMBERSHIP_RECURRING_PRICE_ID=price_... \
STRIPE_MEMBERSHIP_ONE_TIME_PRICE_ID=price_... \
STRIPE_PORTAL_CONFIGURATION_ID=bpc_... \
pnpm test:stripe-acceptance
```

The existing configuration validation is fail-closed: provider execution refuses absent opt-in,
live-mode keys, invalid canonical Stripe objects, unreachable application URLs, ambiguous database
names, or a test destination equal to `POSTGRES_URL`. Production/live Stripe keys must never be
available to test jobs. The database is dropped and migrated, so it must be disposable and dedicated
to one run. Do not point two concurrent runs at the same database or reuse a fixture email.

Stripe test objects are intentionally retained in the test account, unmistakably tagged, for audit
and Dashboard correlation; local database fixtures are destroyed on the next run. Operators may
later remove tagged test objects under the Stripe account's retention policy. Cleanup must never
delete `payments`, `payment_refunds`, audit rows, webhook-event rows, or other historical production
payment evidence.

### Still manual-only

No repository check supplies Stripe Dashboard endpoint-subscription/retry evidence, genuine
Stripe-originated delivery to the public HTTPS endpoint, restricted-key permission/rotation proof,
Customer Portal Dashboard configuration, Vercel deployment/environment evidence, production
backup/restore, alert delivery, operator reconciliation response, or live launch approval. Locally
signed webhook requests intentionally use the production verification/processing route but do not
claim Stripe-originated network delivery. These items remain manual-only in document 27 and must be
attached to the release record by authorized operators.
