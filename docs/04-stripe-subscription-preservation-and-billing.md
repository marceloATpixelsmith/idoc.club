**IDOC**

**Stripe Subscription Preservation & Billing Integration**

How to keep existing recurring subscriptions while adopting the Vercel subscription starter

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.2                                            |
| **Date**             | 2 September 2026                              |

Working project document. Update this document when project decisions change.

# 1. Guiding decision

Do not cancel and recreate legitimate existing Stripe subscriptions solely because the new Next.js application uses a different database or a new canonical Product/Price configuration. The new application should attach itself to the existing Stripe objects by storing their identifiers and responding to verified Stripe events.

# 2. Existing subscription migration pattern

1. Extract the external Stripe Subscription ID from MemberPress where available.

2. Retrieve that subscription from the existing IDOC Stripe account.

3. Verify Stripe Customer, subscription status, Price, current period end, cancel-at-period-end and relevant invoice/payment data.

4. Store the Stripe Customer ID and Subscription ID against the migrated IDOC profile.

5. Seed the local subscriptions table from Stripe's current state.

6. Register the new production webhook endpoint and process future changes idempotently.

7. Leave the original Stripe subscription untouched unless a separately approved billing change is required.

# 3. New memberships

Create or retain one Stripe Product for the one member-facing offering: IDOC Annual Membership, €80 for 12 months. Stripe requires distinct recurring and non-recurring Price configurations, but they are implementation details beneath the same Product and entitlement. The interface must not present them as separate products, plans, tiers, or competing pricing cards.

The first membership-payment page shows one €80 membership and an automatic-renewal control that is on by default. If selected, Checkout uses subscription mode; if cleared, Checkout uses payment mode. Checkout creates or reuses the correct Stripe Customer and associates the result with the authenticated IDOC profile.

The server must carry the authenticated profile identifier and intended billing mode in server-created Checkout metadata. It grants entitlement only after a verified, idempotent successful-payment webhook validates the expected membership Product, amount, currency, and mode; a completed browser redirect is not sufficient.

Implementation target: replace `STRIPE_RECURRING_PRODUCT_ID` and `STRIPE_ONE_TIME_PRODUCT_ID` with one `STRIPE_MEMBERSHIP_PRODUCT_ID`. Historical subscriptions keep their original Product and Price identifiers.

# 4. Legacy Price IDs

Legacy active subscribers may remain on old Price IDs. The application should determine entitlement from the subscription/payment outcome plus IDOC membership rules, not by requiring one exact Price ID for all historical subscriptions.

Migration must preserve each existing subscriber's current Stripe period end and IDOC paid-through/expiration date. Connecting an existing subscription to the new application must not reset its billing anniversary or membership term.

# 4.1 Member-controlled automatic renewal

Automatic renewal is a member-controlled billing preference, not a membership product. A paid member may switch the preference on or off at any time in IDOC Billing Settings, with the change effective only at the next paid-through/renewal date.

- Recurring to non-recurring: set the current subscription to cancel at period end. Do not terminate current entitlement or charge again.
- Non-recurring to recurring: collect reusable payment authorization without an immediate charge and arrange annual billing to start on the existing paid-through date.
- Reversal before effective date: cancel or replace the pending transition without creating a duplicate subscription or charge.
- Every transition: persist the current preference, pending preference, effective date, Stripe schedule/subscription references as applicable, and an audit record. Confirmation messaging must state the effective date and next expected €80 charge.
- IDOC owns this preference and transition workflow. Customer Portal remains available for payment-method updates and invoice history but must not be treated as the source of IDOC renewal preference.

# 5. Required webhook handling

| **Stripe event**                                                    | **Local handling requirement**                                                         |
|---------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| customer.subscription.created                                       | Upsert subscription record; associate only through verified server-side identifiers.   |
| customer.subscription.updated                                       | Refresh status, period dates, cancellation flags and price metadata.                   |
| customer.subscription.deleted                                       | Mark recurring billing ended; do not erase payment/membership history.                 |
| invoice.paid                                                        | Record payment idempotently and update/extend membership according to approved policy. |
| invoice.payment_failed                                              | Record failure and apply grace/notification rule.                                      |
| invoice.payment_action_required or equivalent payment-action signal | Notify/admin flag as appropriate without granting unverified payment.                  |
| checkout.session.completed (payment mode)                            | Validate authenticated-profile metadata, expected membership Product/Price configuration, amount, currency, and paid status; record idempotently. |
| payment_intent.succeeded                                             | Confirm the one-time payment record where applicable; never create a subscription.     |

# 6. Webhook security and reliability

- Verify the Stripe signature using the production webhook signing secret before parsing an event as trusted.

- Use the raw request body required by Stripe signature verification.

- Store processed Stripe event IDs and make handlers idempotent so retries cannot duplicate payments or extend membership twice.

- Return successful HTTP responses only after the event has been durably accepted/processed according to the chosen design.

- Log failures without logging secrets, full card data or unnecessary personal information.

- Support replay/reconciliation from Stripe when an event is missed.

# 7. Customer Portal and email changes

For Stripe-backed paid/grace members, the member portal can generate a Stripe Customer Portal session server-side, allowing the user to manage payment methods and invoices. The application must verify that the authenticated user owns the Stripe Customer ID before creating the portal session. IDOC Billing Settings, not a generic Stripe plan selector, controls whether the membership renews automatically.

After a member verifies an email/username change, update the matching Stripe Customer email server-side. Never use email as the linkage key for a subscription; retain and validate Stripe Customer and Subscription IDs.

# 8. Manual/non-Stripe members

Members paid by bank transfer, PayPal, cash/in person or complimentary grant must not be forced to create Stripe Customers or Subscriptions. Their membership validity is maintained by payment/adjustment records and administrator workflows.

# 9. Stripe reconciliation controls

- Daily or scheduled reconciliation can compare local subscription state with Stripe for anomalous records.

- Admin dashboard should surface subscription status conflicts, orphaned active Stripe subscriptions, repeated payment failures and unlinked Stripe Customers where relevant.

- Never let a browser-submitted Stripe Customer or Subscription ID directly reassign billing ownership.

Implemented (Release 2, Phase 5b): a daily Cron job (`/api/cron/reconciliation-scan`) compares live Stripe data — every Customer, every Subscription (any status), and every open Invoice with two or more failed payment attempts — against the local `subscriptions`/`billing_accounts` tables for the four anomaly categories above. Findings replace a persisted current-snapshot table on every successful run; a separate append-only run-history table records each execution's outcome (including failures, e.g. a Stripe outage) so an administrator can distinguish "ran clean" from "hasn't run." A failed run deliberately leaves the prior snapshot in place rather than clearing it, so a Stripe-side outage never reads as a false "no anomalies." The report is read-only and Administrator-tier (`/admin/reconciliation`); remediation happens through the existing suspend/reinstate/entitlement-correction tools, not on the report itself, so this control never grants an automated write against Stripe data.

# 10. Official references

- Stripe: Using webhooks with subscriptions - [<u>https://docs.stripe.com/billing/subscriptions/webhooks</u>](https://docs.stripe.com/billing/subscriptions/webhooks)

- Stripe: Build a subscriptions integration - [<u>https://docs.stripe.com/billing/subscriptions/build-subscriptions</u>](https://docs.stripe.com/billing/subscriptions/build-subscriptions)

- Stripe: Receive events in your webhook endpoint - [<u>https://docs.stripe.com/webhooks</u>](https://docs.stripe.com/webhooks)

- Vercel: Stripe Subscription Starter - [<u>https://vercel.com/templates/other/subscription-starter</u>](https://vercel.com/templates/other/subscription-starter)

- Vercel GitHub: Next.js Subscription Payments Starter - [<u>https://github.com/vercel/nextjs-subscription-payments</u>](https://github.com/vercel/nextjs-subscription-payments)

# 11. Implementation alignment status

Already implemented and retained:

- authenticated, server-created Checkout in both Stripe modes;
- flat €80 EUR inline Price data;
- server-owned profile metadata and Stripe Customer linkage;
- raw-body webhook signature verification and event-ID idempotency;
- recurring and one-time successful-payment projection into local payments/membership records;
- existing-subscription preservation, Customer Portal ownership checks, cancellation support, reconciliation, and payment/grace notifications.

Implemented but must be changed:

- the current two-card `/pricing` presentation must become one membership-payment gate with one automatic-renewal control;
- the current two configured Stripe Products must become one configured membership Product for new enrollment;
- dashboard authorization currently permits profile-level access before payment and after expiration; it must enforce the payment-only state defined in docs/02;
- the current five-day grace transition is triggered by recurring payment failure but not by non-recurring term expiration; both cases must use the approved rule;
- Customer email-sync failures are persisted as `stripe.customer_email_sync` outbox rows, but no retry worker currently consumes those rows.

Not yet implemented:

- persisted current/pending renewal preference and effective date;
- non-recurring-to-recurring payment-method authorization and future activation;
- cancel/reverse pending renewal-mode transitions;
- the member Billing Settings control and confirmation/audit workflow;
- server-boundary tests for the payment-only state and transition tests listed in docs/25;
- real Stripe test-mode lifecycle and restricted-key-permission verification;
- production Product, webhook, environment-variable, migration, and reconciliation signoff.
