# Membership billing and access remediation

This document is the actionable implementation and acceptance source for the Release 2 work reopened on 2 September 2026. Business policy remains authoritative in docs/02; Stripe behavior remains authoritative in docs/04; this document records how current `main` aligns, what must change, and what production setup remains outstanding.

## 1. Approved product contract

- IDOC offers one Annual Membership at €80 for 12 months, regardless of professional classification or status.
- Automatic renewal is a billing preference for that membership, not a second product, plan, price, tier, or membership type.
- First payment shows one membership and one default-on automatic-renewal control.
- Members may change automatic renewal on or off at any time. A change takes effect only at the next paid-through/renewal date and is reversible before then.
- No preference change charges immediately, shortens paid time, or creates duplicate billing.
- Creating an account or profile does not create membership access.
- Never-paid and post-grace expired accounts receive only the membership-payment gate and logout after authentication.
- A previously paid member retains full member access for five calendar days after either a failed recurring renewal or expiration of a non-recurring term.
- Payment received during grace continues/restores active entitlement. After grace without payment, member access ends and the payment-only state applies.
- Suspension overrides payment/grace and requires separate administrator reinstatement.

## 2. Current implementation alignment

### 2.1 Implemented and retained

| Capability | Current source | Disposition |
|---|---|---|
| Flat fee and currency | `lib/payments/pricing.ts` (`8000`, `eur`) | Retain. |
| Authenticated Checkout creation | `lib/payments/checkout.ts` | Retain server-owned profile/customer resolution and both Stripe modes. |
| No entitlement from browser redirect | `app/api/stripe/checkout/route.ts` | Retain; verified webhook remains authoritative. |
| Raw-body webhook signature verification | `app/api/stripe/webhook/route.ts` | Retain. |
| Webhook event-ID idempotency | `lib/payments/webhook-handlers.ts`, `idoc.stripe_events` | Retain and extend for new transition events if needed. |
| Recurring and one-time payment projection | `lib/payments/webhook-handlers.ts` | Retain after changing expected Product configuration. |
| Stripe Customer ownership mapping | `idoc.billing_accounts` and Checkout/Portal code | Retain. |
| Existing subscription preservation | `idoc.subscriptions`, migration documents, webhook handlers | Retain legacy Product/Price IDs and billing anniversaries. |
| Portal ownership check | `lib/payments/stripe.ts` | Retain for payment methods and invoices. |
| Cancel-at-period-end support | Current Portal configuration/webhook projection | Reuse in the application-owned off transition. |
| Five-day failed-recurring grace | `lib/payments/renewal.ts`, webhook/notification code | Generalize to non-recurring expiration. |
| Reconciliation | `lib/payments/reconciliation*.ts`, daily Cron route | Retain and extend for pending schedules/transitions. |
| Manual payment and entitlement recording | `lib/payments/manual-payments.ts` | Retain. |

### 2.2 Implemented but inconsistent with the approved contract

| Current behavior | Evidence | Required change |
|---|---|---|
| Two member-facing payment cards | `app/(dashboard)/pricing/page.tsx` | Replace with one Membership Payment page and one automatic-renewal control. |
| Two configured Stripe Products | `STRIPE_RECURRING_PRODUCT_ID`, `STRIPE_ONE_TIME_PRODUCT_ID`; `lib/runtime/configuration.ts` | Replace for new Checkout with one `STRIPE_MEMBERSHIP_PRODUCT_ID`. Do not modify valid imported legacy Product/Price linkage. |
| Renewal choice exists only at Checkout | `lib/payments/actions.ts`, `lib/payments/checkout.ts` | Add owned Billing Settings and future-effective switching in both directions. |
| Portal creates only payment/invoice/cancel features | `lib/payments/stripe.ts` | Keep Portal narrow; add IDOC-owned renewal preference rather than exposing plan selection. |
| Dashboard accepts profile-level access | dashboard page/layout and `requireAccountAccess('profile')` call sites | Apply the payment-only gate to every member surface and privileged data boundary. |
| Expired accounts can reach limited dashboard/profile capabilities | membership data-access/dashboard implementation | After five-day grace, allow only payment and logout. |
| Grace begins on recurring payment failure only | `handleInvoicePaymentFailed` and renewal-notice scan | Add non-recurring paid-through expiration entry into the same five-day full-access grace state. |
| Stripe email-sync failure is queued but not retried | `lib/membership/email-verification.ts` inserts `stripe.customer_email_sync`; no consumer exists | Implement a leased, retrying, dead-lettering worker and operational visibility. |

### 2.3 Not implemented

- Persisted current renewal mode, pending mode, effective date, and relevant Stripe schedule/subscription/payment-method references.
- A member Billing Settings switch with current state, paid-through date, pending state, effective date, and next expected €80 charge.
- Non-recurring-to-recurring payment authorization without an immediate charge.
- Future recurring activation exactly at the existing paid-through date.
- Reversal/replacement of a pending renewal-mode transition.
- Transition confirmation and immutable audit evidence.
- Complete payment-only route/action/data-access enforcement.
- Non-recurring expiration-to-grace transition.
- Automated tests and real Stripe test-mode proof for the revised contract.

## 3. Required data and state model

The implementation may use a dedicated `renewal_preferences` table or an equivalently normalized model, but it must represent at least:

```text
profile_id
current_mode: recurring | non_recurring
pending_mode: recurring | non_recurring | null
effective_on: date | null
external_subscription_schedule_id: string | null
payment_authorization_state/reference as required by Stripe
created_at
updated_at
```

Requirements:

- One authoritative renewal-preference record per profile.
- Server-derived profile ownership; no trusted browser-supplied Customer, Subscription, Schedule, payment-method, amount, status, or effective date.
- Concurrency-safe uniqueness preventing more than one effective recurring path.
- Transition and Stripe webhook processing idempotent under retries and reordering.
- Existing `memberships` remains the source of entitlement; renewal preference never grants access by itself.
- Existing `subscriptions` remains the local projection of Stripe subscriptions, including legacy Price IDs.
- Every preference change records actor, before/after values, effective date, and relevant categorical outcome in the audit log without secret/payment-method data.

## 4. Required user flows

### 4.1 First payment

1. Authenticated, onboarded, never-paid account is routed to the Membership Payment page.
2. Page shows one IDOC Annual Membership, €80, 12 months.
3. Automatic renewal control is on by default and can be cleared.
4. The account may log out without paying but cannot enter any dashboard/member route.
5. Checkout uses subscription mode when on and payment mode when off.
6. Verified webhook grants entitlement; the success redirect alone does nothing.
7. Only after entitlement is active does the account enter the dashboard/member site.

### 4.2 Recurring to non-recurring

1. Member turns automatic renewal off in Billing Settings.
2. Server verifies ownership and active/grace entitlement.
3. Stripe subscription is set to cancel at period end.
4. Local preference records the pending non-recurring mode and effective date.
5. Current access and paid-through date do not change.
6. Member sees and receives confirmation of the effective date.

### 4.3 Non-recurring to recurring

1. Member turns automatic renewal on in Billing Settings.
2. Server collects reusable Stripe payment authorization without charging immediately.
3. Server schedules annual €80 billing no earlier than the current paid-through date.
4. Local preference records the pending recurring mode, effective date, and server-owned Stripe references.
5. Current access and paid-through date do not change.
6. Member sees and receives confirmation of the effective date and expected next charge.

### 4.4 Reverse before effective date

1. Member changes the control again.
2. Server cancels/replaces the pending Stripe transition and updates local state atomically or with a recoverable/idempotent workflow.
3. At most one future recurring path remains.
4. Member sees the final preference and effective date.

### 4.5 Grace and post-grace

1. Failed recurring renewal or non-recurring paid-through expiration enters `grace` for exactly five calendar days.
2. During grace, full member and professional-role access remains available with billing notice.
3. Eligible payment during grace returns/continues `active` entitlement.
4. Grace end without payment sets `expired` and routes every subsequent authenticated request to payment/logout only.

## 5. Authorization acceptance inventory

Payment-only accounts must be denied from, at minimum:

- dashboard home and every nested dashboard page;
- profile and professional-role reads/updates;
- security-management pages/actions other than logout;
- member payment history and generic Stripe Portal access;
- member-only CMS, seminar, news, downloads, APIs, searches, feeds, and previews;
- every Server Action or Route Handler that delegates to member data;
- direct data-access calls classified as member/profile capabilities.

The membership-payment page, its server-owned Checkout/setup actions, webhook return landing, and logout remain available. Administrator and Super Admin access is evaluated under their authoritative application-role policy; a normal account cannot bypass payment by submitting an administrator flag or route.

## 6. Stripe configuration target

Required production variables after remediation:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_MEMBERSHIP_PRODUCT_ID
BASE_URL
POSTGRES_URL
CRON_SECRET
MAILCHIMP_TRANSACTIONAL_API_KEY
IDOC_ADMIN_NOTIFICATION_EMAIL
```

The implementation currently still consumes `STRIPE_RECURRING_PRODUCT_ID` and `STRIPE_ONE_TIME_PRODUCT_ID`; replace them in code, runtime validation, tests, `.env.example`, build-boundary inventories, and operations documentation as one coordinated deployment. Do not remove current deployed values until replacement code is live.

The production Stripe webhook must deliver every event consumed by current payment/subscription handling plus any Subscription Schedule or SetupIntent events selected by the final transition design. The exact event list and restricted-key permissions must be documented from the implemented calls before production signoff.

## 7. Required automated tests

- one membership payment presentation; no second product/card/plan wording;
- default-on renewal control and both first-payment modes;
- never-paid login and direct-URL/action/data-access denial;
- verified payment is the only transition into member access;
- recurring to non-recurring, correct effective date, no immediate charge;
- non-recurring to recurring, payment authorization, future start, no immediate charge;
- reversal before effective date in both directions;
- repeated/concurrent transition requests and webhook replay/reordering;
- no duplicate Customer, subscription, schedule, payment, or entitlement extension;
- failed authorization and Stripe outage recovery;
- recurring-failure and non-recurring-expiration grace entry;
- full access throughout exactly five grace days and payment-only denial afterward;
- payment during and after grace;
- suspended membership cannot self-reactivate by payment;
- legacy subscriptions retain Product/Price/anniversary linkage;
- Stripe Customer email-sync retry, lease safety, bounded attempts, and dead-letter behavior;
- reconciliation detects inconsistent pending schedules/preferences;
- secret and browser-output boundary tests include the new environment/state fields.

## 8. Required real Stripe test-mode signoff

Automated injected clients do not replace this gate. In an isolated staging database and Stripe test mode, verify:

- both first-payment modes and all subscribed webhook events;
- the one Product appears correctly in Checkout without two member-facing plans;
- payment-method authorization without charge;
- future recurring activation and reversal before start;
- cancel-at-period-end and member-visible state;
- failed-payment retry/grace behavior using Stripe test clocks where practical;
- Customer Portal payment-method/invoice behavior;
- webhook retry/idempotency and out-of-order handling;
- reconciliation pagination and findings;
- restricted-key permissions for every SDK call;
- Vercel routes, Cron authentication, logs, alerts, and absence of secrets/financial data in evidence.

Record environment, deployment SHA, Stripe test object IDs needed for audit, tester, date, and pass/fail outcome without recording secrets or full payment details.

## 9. Completion gate

This remediation is complete only when:

- code, schema, tests, `.env.example`, docs/02, docs/04, docs/06, docs/07, and docs/08 agree;
- the payment-only boundary is enumerated and tested across every member surface;
- both renewal transitions and reversal are implemented and idempotent;
- both expiry paths use the same five-day grace rule;
- Stripe email-sync retry is real, not merely queued;
- all automated release checks pass on the final revision;
- real Stripe test-mode signoff passes;
- production Product, restricted key, webhook, environment variables, migrations, legacy linkage, and reconciliation are checked off before live billing.
