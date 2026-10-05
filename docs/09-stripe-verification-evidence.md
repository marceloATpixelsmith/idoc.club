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

## Running the suite from a sandbox without a public tunnel

Use this procedure for agent or cloud sandboxes whose outbound traffic is proxied and allow-listed
(no ngrok, no Cloudflare tunnel, no public URL). It keeps every Stripe interaction in test mode and
never touches staging or production data. Never print or commit any value named below.

**Network allow-list** (Stripe CLI and hosted Checkout): `api.stripe.com`, `stripecli-ws-nw.stripe.com`,
`checkout.stripe.com`, `js.stripe.com` and the other `*.stripe.com`, `*.stripe.network`, `*.stripecdn.com`
hosts Checkout loads (it also loads `*.hcaptcha.com` frames; allow them so a risk check cannot be blocked).
`net::ERR_TUNNEL_CONNECTION_FAILED` when it redirects to `checkout.stripe.com`.

1. **Runtime.** Node 24.9 (Node 22 lacks Argon2id), `pnpm install --frozen-lockfile`, and a running local
   PostgreSQL (`service postgresql start`; it can stop mid-session, so re-check before each run).
2. **Stripe CLI.** If the GitHub release download is blocked, build it through the Go module proxy:
   `GOBIN=/usr/local/bin go install github.com/stripe/stripe-cli/cmd/stripe@<version>`.
3. **Throwaway database.** Create a local role and two databases: `idoc_test_stripe_<run>` for
   `TEST_DATABASE_URL` (global setup drops and rebuilds its `idoc` schema) and a different
   `idoc_e2e_app_<run>` for `POSTGRES_URL`. Never reuse staging's `POSTGRES_URL`, `AUTH_SECRET`,
   `CRON_SECRET`, `BASE_URL` or Google redirect. Generate fresh random `AUTH_SECRET` and `CRON_SECRET`.
4. **Local HTTPS.** `BASE_URL` must be HTTPS (`validateStripeBaseUrl`), and Stripe Checkout redirects the
   browser back to it. Create a throwaway CA and a `localhost` certificate with `openssl`, import the CA into
   Chromium's NSS store (`certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n e2e-ca -i ca.crt`), and run a
   small TLS reverse proxy on `https://localhost:3443` that forwards to `next dev -p 3000` and rewrites any redirect
   `Location` of `https://localhost:3000` back to `https://localhost:3443` (Next builds redirect URLs from its own
   origin; without the rewrite the browser lands on port 3000 after Checkout and fails with `ERR_SSL_PROTOCOL_ERROR`). Set
   `BASE_URL` and `STRIPE_E2E_APP_URL` to `https://localhost:3443`.
5. **Webhooks without a tunnel.** Run `STRIPE_API_KEY=$STRIPE_SECRET_KEY stripe listen --events <list> --forward-to
   http://localhost:3000/api/stripe/webhook` (use the environment variable, not `--api-key`, so the key never
   appears in the process list). `<list>` is the event set in `lib/payments/webhook-handlers.ts`
   (`charge.dispute.closed`, `charge.dispute.created`, `charge.refunded`, `checkout.session.completed`,
   `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_action_required`,
   `invoice.payment_failed`, `payment_intent.succeeded`). Use the signing secret it prints as
   `STRIPE_WEBHOOK_SECRET` for both the app and the suite; no Dashboard endpoint is created, so there is
   nothing to delete afterwards.
6. **Safe third-party settings for the app process.** Use Cloudflare's public always-pass Turnstile test keys
   (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`), a dummy `BREVO_API_KEY`, and an
   empty `MAILCHIMP_MARKETING_API_KEY`, so a run cannot send real mail or add marketing contacts.
7. **Proxy-aware Node.** Both the app and the test runner call Stripe from Node, which ignores
   `HTTPS_PROXY` by default. Export `NODE_USE_ENV_PROXY=1` and point `NODE_EXTRA_CA_CERTS` at a bundle holding the
   sandbox proxy CA plus the throwaway CA. Start the app with that same environment.
8. **App launch.** Either start `next dev -p 3000` yourself (with the environment above) or set
   `STRIPE_E2E_START_COMMAND`; the configuration passes only `TEST_DATABASE_URL` to a launched app, so keep
   `POSTGRES_URL` distinct from it (the database guard refuses identical values).
9. **Run.** `pnpm test:stripe-e2e` needs no extra flags: the script already passes
   `--conditions=react-server` (the seminar spec imports a `server-only` module) and the configuration keeps
   Playwright's automatic tracing off because the hosted Checkout spec records its own. Set
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when the installed Chromium build differs from the one Playwright expects.
   Use a unique `STRIPE_E2E_MEMBER_EMAIL=stripe-e2e-<run>@example.test` and
   `STRIPE_E2E_EVIDENCE_DIR=.stripe-e2e/evidence/<run>`; `.stripe-e2e/` is not gitignored, so do not commit it.
   Global setup starts the profile id sequence at a per-run offset because the application derives Stripe
   idempotency keys from profile ids and Stripe keeps them for 24 hours; without it a second run inside 24
   hours is rejected with `StripeIdempotencyError`.
10. **Clean up.** Stop the app, TLS proxy and `stripe listen`; drop both databases and the role; delete the
    throwaway certificates. Do not leave test-mode objects that identify a person.

Hosted Checkout requires a cardholder name, a postal code when the billing country has one, and a phone number
while "Save my information" (Link) is ticked; `tests/stripe-e2e/support/hosted-card.ts` fills the first two and
unticks Link. Its submit button is `data-testid="hosted-payment-submit-button"`; seminar registration starts on the seminar's own page (`tests/stripe-e2e/support/seminar-registration.ts`).
When the application's UI changes, update the specs rather than weakening the application.

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
