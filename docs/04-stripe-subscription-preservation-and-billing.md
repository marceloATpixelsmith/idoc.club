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

## Current staging alignment — 3 October 2026

For the cross-domain current-state contract, see [document 28](28-auth-membership-seminar-current-state.md). The current implementation preserves these billing invariants:

- Membership access changes only from verified, idempotent Stripe webhook evidence or an approved audited administrator workflow; browser success redirects are never payment authority.
- Enabling automatic renewal for an already-paid non-recurring member uses Stripe Checkout `setup` mode to collect payment authorization without an immediate charge. The pending recurring transition is effective on the membership's current `valid_until`, with persisted transition state and stable idempotency.
- Disabling automatic renewal sets the existing subscription to `cancel_at_period_end`; it does not cancel the membership or shorten paid entitlement.
- Seminar Checkout uses separate metadata classifications, registration/payment records, and webhook handlers. Seminar payments never update membership entitlement even when amounts or Stripe customers overlap.


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

For Stripe-backed paid/grace members, the dashboard's own Payment Method box (a section of the My Membership page, `/dashboard`, next to the Membership box) can generate a Stripe Customer Portal session server-side, letting the member update the card on file. The application must verify that the authenticated user owns the Stripe Customer ID before creating the portal session. This Portal Configuration is scoped to `payment_method_update` only -- never `invoice_history` or `subscription_cancel` -- so a member is never able to cancel or view invoices through Stripe's own UI; IDOC's dashboard is the sole place recurrence, cancellation, and payment history are tracked (docs/02 §5.1). The session also sets `flow_data` to `type: 'payment_method_update'` with an `after_completion` redirect, so it deep-links straight into Stripe's add/update card form instead of the portal's own home page, and returns the member to `/dashboard` the instant the card is saved rather than leaving them on a Stripe-hosted confirmation screen. The session's `return_url` brings the member back to that same page either way (a plain same-tab navigation; there is no separate page left open elsewhere to protect with a new window). IDOC Billing Settings, not a generic Stripe plan selector, controls whether the membership renews automatically.

After a member verifies an email/username change, update the matching Stripe Customer email server-side. Never use email as the linkage key for a subscription; retain and validate Stripe Customer and Subscription IDs.

# 8. Manual/non-Stripe members

Members paid by bank transfer, administrator-registered Stripe payment, cash/in person or complimentary grant must not be forced to create Stripe Customers or Subscriptions. Their membership validity is maintained by payment/adjustment records and administrator workflows.

# 9. Stripe reconciliation controls

- Daily or scheduled reconciliation can compare local subscription state with Stripe for anomalous records.

- Admin dashboard should surface subscription status conflicts, orphaned active Stripe subscriptions, repeated payment failures and unlinked Stripe Customers where relevant.

- Never let a browser-submitted Stripe Customer or Subscription ID directly reassign billing ownership.

Implemented (Release 2, Phase 5b): a daily Cron job (`/api/cron/reconciliation-scan`) compares live Stripe data — every Customer, every Subscription (any status), and every open Invoice with two or more failed payment attempts — against the local `subscriptions`/`billing_accounts` tables for the four anomaly categories above. The subscription findings replace the subscription portion of the persisted current snapshot on every successful run. Event-sourced financial findings for refunds, disputes, chargebacks, and seminar-payment conflicts are retained until explicitly resolved or superseded; a separate append-only run-history table records each execution's outcome (including failures, e.g. a Stripe outage) so an administrator can distinguish "ran clean" from "hasn't run." A failed run deliberately leaves the prior snapshot in place rather than clearing it, so a Stripe-side outage never reads as a false "no anomalies." The report is read-only and Administrator-tier (`/admin/reconciliation`); remediation happens through the existing suspend/reinstate/entitlement-correction tools, not on the report itself, so apart from the production-only remediation in §9.1, this control never writes to Stripe.

## 9.1 What the scan resolves by itself

The reconciliation scan does not just report: every case where the correct action is known is carried out **before** the findings are recorded, so the report that follows lists only what a person must investigate and nobody has to rescan. The same logic runs on staging and production; the only difference is whether Stripe itself is changed.

- **Changes to IDOC's own database always happen** (staging and production alike). Each is conditional on what the scan read (skipped if the row changed meanwhile), runs in one transaction with its audit row, and never changes membership entitlement.
- **Changes to Stripe happen only where the deployment may write to Stripe** (`remediationAllowed()` in `lib/payments/remediation-gate.ts`): the production schema with a Stripe key whose mode matches the deployment, and for a live deployment the member communications and billing hold released. A test-mode deployment of the production schema may write to the Stripe sandbox (no real money or member exists there). Everywhere else (staging, the legacy-import rehearsal read key) these actions are **simulated**: the same checks run, the item leaves the report exactly as it would have, and the action is logged and shown as simulated, so a staging scan shows what a production scan will do and a production scan makes the change so later scans no longer find it.

The cases (audit action `reconciliation.*`; a summary of every scan is stored as `reconciliation.scan_resolution_summary` and shown in the Last run box):

| Case | Action | Where |
|---|---|---|
| Subscription status differs from Stripe | Update IDOC's copy (status, period end, cancel-at-period-end, price) to Stripe's, as the subscription notifications would; a cancelled subscription returns the renewal setting to non-recurring; cancel-at-period-end records the pending cancellation. A status the table cannot store (`paused`) is reported. | IDOC |
| Subscription IDOC treats as open that Stripe does not have | Mark it cancelled in IDOC (billing has ended). | IDOC |
| Renewal change whose Stripe schedule finished (completed/released) with a running subscription | Mark the change complete. | IDOC |
| Renewal change whose Stripe schedule was cancelled or no longer exists | Drop the waiting change; the member's current renewal option stands. The member is not notified. | IDOC |
| Registration awaiting payment whose own stored Checkout Stripe confirms paid in full (ownership, session, PaymentIntent, customer, amount and EUR all match, as the checkout notification requires) | Record the payment and queue the confirmation with the same dedupe key as the notification, so it cannot double-send. Any other mismatch is reported. | IDOC |
| Open Stripe subscription IDOC has no record of | Cancel it, so it cannot charge someone who was removed. It must be at least a day old, still open in Stripe and still unknown to IDOC at the moment of cancellation. | Stripe |
| Stripe customer IDOC has no record of | Delete it. It must be at least a day old, still unlinked, with no subscription that is not cancelled, no open invoice and no charge in the last 90 days; a customer whose orphaned subscription was handled in the same scan waits for the next one. | Stripe |

**Stripe event replay (library; the Super Admin page follows).** Events this site missed (the webhook endpoint did not exist yet, DNS pointed at the old site, or the launch hold consumed them without applying them) are read from Stripe's List Events API (last 30 days, handled event types only) and applied by the same handler a live webhook uses (`lib/payments/stripe-event-replay.ts`). Payments are unique by invoice, so a repeat does nothing. A preview classifies each event as new, consumed by the hold, or already processed; applying refuses while the launch hold is on, when the reviewed count has changed, or without the typed confirmation, applies oldest first, and writes an `admin.stripe_event_replay.applied` audit row. The start time must be the moment the legacy export was taken, so payments already in the export are not applied twice. An older state event (payment failed, action required, subscription created/updated/deleted) that a newer, already applied event for the same customer has overtaken is listed as superseded and not replayed, so a stale event cannot move a membership backwards; a missed payment is never superseded. A replayed one-time membership checkout is dated from Stripe's event time (not the processing time), so the payment date and paid-through date match the original payment.

**Import-verified safeguard.** Real Stripe changes against a live key also need the server-only variable `RECONCILIATION_LIVE_STRIPE_ACTIONS` to be exactly `enabled` (`stripeActionStatus` in `lib/payments/remediation-gate.ts`). It is unset by default, so the first live scans after launch only simulate the Stripe changes (the Last run box and the scan email say so) until an operator has verified the legacy import and sets it, followed by a redeploy. It does not affect the website-database changes or a Stripe sandbox (test-mode) deployment. The launch hold still has to be released first.

**What a finding shows.** Repeated payment failures record why the latest payment was declined (read from Stripe's most recent failed charge for the customer, best effort) and when Stripe will retry; orphaned subscriptions and unlinked customers record the name and email Stripe holds. These appear in the summary and the CSV export. The "Missing refund" type was removed in migration 0077 because the system never raised it. An open IDOC subscription that Stripe does not have is listed under its own Type, "Subscription missing from Stripe".

**Wrong-database guard.** For three classes (missing-from-Stripe subscriptions, orphaned subscriptions, unlinked customers) the scan acts only when the affected items are a normal exception: five or fewer, or at most 20 percent of everything compared. A larger share looks like a database that is not yet populated (for example before the legacy import) or a mismatched Stripe account (test against live), so nothing in that class is acted on, the items stay in the report and the Last run box says why.

**What is left needs a person, and **Ignore** is the one manual control.** Everything the scan cannot resolve is listed (for example repeated payment failures, where someone should contact the member). When an administrator has dealt with an issue as far as they can (the member was contacted and cannot or will not update their payment, say), they select the row(s) and choose **Ignore** in the table's selection bar. It is offered only while every selected row is the same Type and ignorable; the server re-checks every finding and each ignore is audited (`reconciliation.finding_ignored`).

- An ignore on a scan-raised issue is stored in `reconciliation_ignores` (migration 0076), keyed by kind and subject (the Stripe subscription or customer ID, or `registration:<id>`). The scan leaves a matching issue out of the report **and out of its automatic actions** (an ignored unlinked customer is never auto-deleted). An ignore is dropped by the scan once the issue it covers no longer exists, so a later recurrence is reported afresh; an administrator can restore one at any time from the **Ignored issues** list on the page (`reconciliation.ignore_restored`).
- Notices raised by Stripe notifications (refund, dispute and chargeback notices, a payment for a suspended or cancelled membership, a webhook blocked by the launch hold, a failed schedule setup) are not re-detected by the scan and stay until closed; **Ignore** closes them (`reconciliation.finding_closed`).
- There is no manual delete of Stripe customers: the scan deletes the ones it can prove safe, and the rest need investigation or an ignore.
- **Super Admin email after each scheduled scan.** The daily cron run emails every active Super Admin a counts-only summary (findings waiting per Type, what the scan resolved or simulated, a link to the page), or a failure notice if the scan failed (`lib/payments/reconciliation-notice.ts`). It is best effort: the member communications and billing launch hold, a missing mail configuration or a provider error is logged (`reconciliation_scan_notice_failed`) and never fails the scan. A manual "Run scan now" does not email; its result is shown on the page.
- **Export selected CSV** on the findings table includes, for every Type, the member's first name, last name and email (when no IDOC member is linked, a repeated payment failure uses the name and email Stripe held on the invoice when the scan ran, with a note saying it is not an IDOC member; an orphaned subscription or unlinked customer likewise uses the name and email on its Stripe customer, and its columns stay blank with a note only when Stripe holds none. Contact details on findings created before this change appear after the next scan), the Stripe ID, and `reasonForManualReview`, the plain-language reason the scan left that finding for a person (`manualReviewReason` in `lib/payments/reconciliation-report.ts`).

Seminar findings are tied to seminars only through a real registration: a Stripe refund or dispute whose PaymentIntent does not belong to a seminar registration (legacy site payments, payment links, other Dashboard activity) is ignored by the webhook handlers and is not recorded as a "Seminar" finding. The scan also removes older refund, dispute and chargeback findings whose PaymentIntent matches no registration.

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

### Seminar Checkout provider re-verification

For a seminar `checkout.session.completed` event, the handler retrieves the exact Session ID from
Stripe before crediting the registration. The retrieved test/live provider object must match the
locally owned billing Customer, active registration, profile, seminar, stored Checkout Session,
authoritative database price, expected amount, EUR currency, paid status, and a PaymentIntent. A
mismatch creates reconciliation evidence and never credits the registration. Seminar payments and
refunds never alter membership entitlement. Stripe E2E fixtures add an unmistakable per-run tag to
PaymentIntent and Refund metadata; ordinary member objects do not receive test metadata.

## Member communications and billing launch hold

The server-only `DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING` setting overrides outgoing communications and live billing initiation: only exact `false` releases it. Missing, empty and invalid values block. Validated Stripe test-mode mutations remain available, while all email remains held. Existing local accounting/entitlement rules and read-only reconciliation continue. Follow [the complete launch-hold runbook](27-member-communications-and-billing-launch-hold.md) for webhook/queue handling, staging isolation, migration verification and explicit operator release.

## Daily Stripe reconciliation: seminar payments

The administrative **Stripe Reconciliation** page combines findings for **Membership** and **Seminar**, offers a category filter, and presents them in three tabs (summary by type, the full table, and a plain-language guide to each type; see docs/07 section 13.1). It reports only; it takes no corrective action in IDOC or Stripe, and fixes remain the member and seminar tools and the Stripe Dashboard. The daily read-only cron scan compares membership subscriptions, subscription schedules, open subscription invoices, and Stripe customers, plus locally recorded online seminar registrations with a Stripe Checkout Session or PaymentIntent reference. Offline bank-transfer/cash registrations are not checked against Stripe.

For each referenced seminar payment, the scan retrieves Stripe Checkout and PaymentIntent evidence and reports a `seminar_payment_conflict` if Stripe reports payment received while the local registration is still awaiting payment, if an unsuccessful payment is marked paid locally, if the settled amount differs from the recorded expected amount, or if the currency differs. A normal open/pending checkout is not a conflict. Refunded, partially refunded, disputed, or charged-back registrations retain their payment history and are not automatically reverted merely because the original Stripe payment succeeded. The scan is **diagnostic only**; staff should verify discrepancies in Stripe and the Seminar Registrations admin area before making manual corrections.

The daily scan replaces only its own `seminar_payment_conflict` findings tagged `details.source = daily_seminar_scan` on successful completion. Existing findings from Stripe webhooks, including refund conflicts, missing refunds, disputes, chargebacks, and other seminar payment conflicts, are retained. If Stripe retrieval fails, the scan records a failed run and keeps the prior snapshot rather than falsely reporting no issues. The current scan checks registrations with stored Stripe identifiers; it is **not** a complete discovery audit for Stripe payments with no local registration or stored Stripe reference.
