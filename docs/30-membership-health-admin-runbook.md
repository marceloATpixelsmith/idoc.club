# Membership Health: administrator operations

The shared Admin and Super Admin navigation includes **Membership Health** at `/admin/membership-health`.

## Purpose and evidence

This report is a read-only operational investigation tool. It does not grant entitlements, retry charges, deliver messages, reconcile Stripe, or change membership data. Administrators investigate cases by following the member's history link; actual financial reconciliation and interventions remain in the existing Stripe reconciliation and member workflows.

- A renewal notice **queued** is not necessarily sent.
- The notification outbox **sent** flag means the sending provider accepted the message, not that it reached a person's inbox.
- The Brevo webhook delivery log is stronger evidence of delivered/blocked/bounced status; missing log rows are unverified, not automatically failures.
- A checkout session is an attempt, not payment.
- A recorded payment is evidence that payment succeeded, but does not independently establish that a membership term was advanced.
- A payment recorded after a reminder is only *temporal correlation*, not evidence that the email caused renewal.
- Renewal cohorts must be constructed from durable historical expiration periods: the current `memberships.valid_until` field is mutable and cannot by itself represent expired periods after successful renewals.

## Filters

Each date-related report accepts an arbitrary date range through the existing administrator date-range component. No presets are imposed. Both bounds are inclusive calendar days. Blank bounds mean unbounded; clearing the control means All time. Settings for read-only record tables and the overall reporting period are persisted per administrator, not encoded into the page URL. Only the selected tab belongs in the URL.

The selected range has a different meaning for different reports:
- Renewal tracking and cohorts: expiration-date range.
- Notification performance: notice queue creation range.
- Checkout and payment totals: recorded transaction creation/payment dates.
- Unresolved reconciliation issues: always visible, independent of range, so older critical incidents cannot disappear accidentally.

## Operational use

Start with **Issues & Alerts**; inspect unresolved Stripe findings, missing notifications, and checkout failures. Next use **Renewal Tracking** to open a specific member's history. Compare notification outbox and Brevo evidence, checkout attempts, payment entries, and entitlement dates. Use **Notification Performance** to investigate bounces and undelivered notices. Compare previous completed cohorts in **Trends & Cohorts**, noting grace periods and the early/late renewal rules.

A payment beyond the prior expiration date without an updated entitlement needs investigation, but must not be automatically corrected or refunded from this report. Escalation, assignment, audited resolution and alert delivery are separate operational actions, not implied by simply viewing a read-only row.

Historical limitations: records predating the durable activity, email-delivery and renewal period tracking may be unavailable; do not classify missing historical evidence as member negligence. The report uses a bounded per-member observation window for correlation, and it is not a causal attribution model.
