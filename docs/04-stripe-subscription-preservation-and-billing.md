**IDOC**

**Stripe Subscription Preservation & Billing Integration**

How to keep existing recurring subscriptions while adopting the Vercel subscription starter

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.1                                            |
| **Date**             | 11 August 2026                                 |

Working project document. Update this document when project decisions change.

# 1. Guiding decision

Do not cancel and recreate legitimate existing Stripe subscriptions solely because the new Next.js application uses a different database or a new canonical Stripe Price. The new application should attach itself to the existing Stripe objects by storing their identifiers and responding to verified Stripe events.

# 2. Existing subscription migration pattern

1. Extract the external Stripe Subscription ID from MemberPress where available.

2. Retrieve that subscription from the existing IDOC Stripe account.

3. Verify Stripe Customer, subscription status, Price, current period end, cancel-at-period-end and relevant invoice/payment data.

4. Store the Stripe Customer ID and Subscription ID against the migrated IDOC profile.

5. Seed the local subscriptions table from Stripe's current state.

6. Register the new production webhook endpoint and process future changes idempotently.

7. Leave the original Stripe subscription untouched unless a separately approved billing change is required.

# 3. New memberships

Create or retain one Stripe Product with two required €80 prices for new standard memberships: a recurring annual Price for automatic renewal and a distinct non-recurring Price for one-time membership. Both represent the approved 12-month term. New Checkout defaults to automatic renewal but offers the member-selectable one-time option. The recurring path uses Checkout in subscription mode; the one-time path uses Checkout in payment mode. Checkout creates or reuses the correct Stripe Customer and associates the resulting billing relationship with the authenticated IDOC profile.\n\nThe server must carry the authenticated member identifier and intended payment path in server-created Checkout metadata. It grants one-time entitlement only after it verifies a successful, idempotent payment webhook against the expected one-time Price; a completed browser redirect is not sufficient.

# 4. Legacy Price IDs

Legacy active subscribers may remain on old Price IDs. The application should determine entitlement from the subscription/payment outcome plus IDOC membership rules, not by requiring one exact Price ID for all historical subscriptions.

Migration must preserve each existing subscriber's current Stripe period end and IDOC paid-through/expiration date. Connecting an existing subscription to the new application must not reset its billing anniversary or membership term.

# 5. Required webhook handling

| **Stripe event**                                                    | **Local handling requirement**                                                         |
|---------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| customer.subscription.created                                       | Upsert subscription record; associate only through verified server-side identifiers.   |
| customer.subscription.updated                                       | Refresh status, period dates, cancellation flags and price metadata.                   |
| customer.subscription.deleted                                       | Mark recurring billing ended; do not erase payment/membership history.                 |
| invoice.paid                                                        | Record payment idempotently and update/extend membership according to approved policy. |
| invoice.payment_failed                                              | Record failure and apply grace/notification rule.                                      |
| invoice.payment_action_required or equivalent payment-action signal | Notify/admin flag as appropriate without granting unverified payment.                  |\n| checkout.session.completed (payment mode)                            | Validate authenticated-member metadata, expected one-time Price and paid status; record the session idempotently. |\n| payment_intent.succeeded                                              | Confirm the one-time payment record where applicable; never create a subscription. |

# 6. Webhook security and reliability

- Verify the Stripe signature using the production webhook signing secret before parsing an event as trusted.

- Use the raw request body required by Stripe signature verification.

- Store processed Stripe event IDs and make handlers idempotent so retries cannot duplicate payments or extend membership twice.

- Return successful HTTP responses only after the event has been durably accepted/processed according to the chosen design.

- Log failures without logging secrets, full card data or unnecessary personal information.

- Support replay/reconciliation from Stripe when an event is missed.

# 7. Customer Portal and email changes

For Stripe-backed members, the member portal can generate a Stripe Customer Portal session server-side, allowing the user to manage payment methods, invoices and permitted subscription actions. The application must verify that the authenticated user owns the Stripe Customer ID before creating the portal session.

After a member verifies an email/username change, update the matching Stripe Customer email server-side. Never use email as the linkage key for a subscription; retain and validate Stripe Customer and Subscription IDs.

# 8. Manual/non-Stripe members

Members paid by bank transfer, PayPal, cash/in person or complimentary grant must not be forced to create Stripe Customers or Subscriptions. Their membership validity is maintained by payment/adjustment records and administrator workflows.

# 9. Stripe reconciliation controls

- Daily or scheduled reconciliation can compare local subscription state with Stripe for anomalous records.

- Admin dashboard should surface subscription status conflicts, orphaned active Stripe subscriptions, repeated payment failures and unlinked Stripe Customers where relevant.

- Never let a browser-submitted Stripe Customer or Subscription ID directly reassign billing ownership.

# 10. Official references

- Stripe: Using webhooks with subscriptions - [<u>https://docs.stripe.com/billing/subscriptions/webhooks</u>](https://docs.stripe.com/billing/subscriptions/webhooks)

- Stripe: Build a subscriptions integration - [<u>https://docs.stripe.com/billing/subscriptions/build-subscriptions</u>](https://docs.stripe.com/billing/subscriptions/build-subscriptions)

- Stripe: Receive events in your webhook endpoint - [<u>https://docs.stripe.com/webhooks</u>](https://docs.stripe.com/webhooks)

- Vercel: Stripe Subscription Starter - [<u>https://vercel.com/templates/other/subscription-starter</u>](https://vercel.com/templates/other/subscription-starter)

- Vercel GitHub: Next.js Subscription Payments Starter - [<u>https://github.com/vercel/nextjs-subscription-payments</u>](https://github.com/vercel/nextjs-subscription-payments)
