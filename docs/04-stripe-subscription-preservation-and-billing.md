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

Implemented: new enrollment and renewal schedules use `STRIPE_MEMBERSHIP_PRODUCT_ID`; historical subscriptions keep their original Product and Price identifiers.

# 4. Legacy Price IDs

Legacy active subscribers may remain on old Price IDs. The application should determine entitlement from the subscription/payment outcome plus IDOC membership rules, not by requiring one exact Price ID for all historical subscriptions.

Migration must preserve each existing subscriber's current Stripe period end and IDOC paid-through/expiration date. Connecting an existing subscription to the new application must not reset its billing anniversary or membership term.

# 4.1 Member-controlled automatic renewal

Automatic renewal is a member-controlled billing preference, not a membership product. A paid member may switch the preference on or off at any time in IDOC Billing Settings, with the change effective only at the next paid-through/renewal date.

- Recurring to non-recurring: set the current subscription to cancel at period end. Do not terminate current entitlement or charge again.
- Non-recurring to recurring: collect reusable payment authorization without an immediate charge and arrange annual billing to start on the existing paid-through date.
- **Approved mechanism (10 September 2026):** use Stripe Checkout `setup` mode. Only a verified
  `checkout.session.completed` webhook may retrieve and validate the succeeded, `off_session`
  SetupIntent and its Customer-owned PaymentMethod. The handler idempotently creates a recurring
  EUR 80 Price under `STRIPE_MEMBERSHIP_PRODUCT_ID`, then one Subscription Schedule whose
  `start_date` is midnight UTC on the existing `valid_until` date and whose default payment method
  is that authorization. Local state retains the Checkout Session, SetupIntent, PaymentMethod,
  Price, and Schedule identifiers. Neither Checkout return nor setup completion changes entitlement;
  the schedule's resulting subscription and paid invoice remain webhook-authoritative.
- Reversal before effective date: cancel or replace the pending transition without creating a duplicate subscription or charge.
- Every transition: persist the current preference, pending preference, effective date, Stripe schedule/subscription references as applicable, and an audit record. Confirmation messaging must state the effective date and next expected €80 charge.
- IDOC owns this preference and transition workflow. Customer Portal remains available for payment-method updates and invoice history but must not be treated as the source of IDOC renewal preference. Portal Configuration creation is convergent under concurrent first requests: IDOC reuses its tagged configuration, concurrent requests within one process share one in-flight creation, and a stable Stripe idempotency key converges creation across application instances before Portal Sessions are created.

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
| refund.created / refund.updated / refund.failed                      | Preserve refund attempts/provider evidence and project only verified matched state.    |
| charge.refunded                                                      | Match direct refunds to their original payment or create a retained finding.            |
| charge.dispute.created / charge.dispute.closed                       | Preserve actionable dispute/chargeback evidence without unrelated entitlement changes. |

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

Implemented (Release 2, Phase 5b): a daily Cron job (`/api/cron/reconciliation-scan`) compares live Stripe data — every Customer, every Subscription (any status), and every open Invoice with two or more failed payment attempts — against the local `subscriptions`/`billing_accounts` tables for the four anomaly categories above. The subscription findings replace the subscription portion of the persisted current snapshot on every successful run. Event-sourced financial findings for refunds, disputes, chargebacks, and seminar-payment conflicts are retained until explicitly resolved or superseded; a separate append-only run-history table records each execution's outcome (including failures, e.g. a Stripe outage) so an administrator can distinguish "ran clean" from "hasn't run." A failed run deliberately leaves the prior snapshot in place rather than clearing it, so a Stripe-side outage never reads as a false "no anomalies." The report is read-only and Administrator-tier (`/admin/reconciliation`); remediation happens through the existing suspend/reinstate/entitlement-correction tools, not on the report itself, so this control never grants an automated write against Stripe data.

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

The payment gate, one-Product model, both grace paths, post-grace authorization, durable renewal
preference/transition state, Setup Checkout, future schedule, reversal, Billing Settings, email-sync
retry, and automated server-boundary coverage are implemented. The remaining gate is operational:
the complete real Stripe test-mode evidence and the production configuration/migration checklist in
docs/07 must be completed by an operator. Fake-client tests are necessary regression evidence but are
not a substitute for provider evidence, and no live-payment test may be claimed without supplied,
verified live evidence.


## 11.1 Checkout Session expiry and retry

Checkout idempotency is tied to the current paid-through cycle only while the associated append-only
`membership_checkout_sessions` row is open and provider retrieval confirms it is payable. The row
persists its profile, mode, cycle, provider ID, status, expiration, URL, attempt number, and exact
idempotency key. Profile-scoped transaction locking serializes first creation and replacement. If
that Session expires, completes, is canceled, or otherwise becomes unpayable, IDOC marks the prior
row terminal, rotates the attempt/key, creates a replacement, and retains all earlier rows as
evidence. It never returns an expired Checkout URL on retry.
