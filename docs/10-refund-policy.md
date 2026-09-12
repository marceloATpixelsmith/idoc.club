# IDOC Refund Policy

## Scope

This policy applies to IDOC membership payments and seminar registration payments.

Refunds are discretionary administrative actions. IDOC does not issue automatic refunds.

## Membership payments

A member-initiated cancellation before the next scheduled charge does not require a refund.

An administrator may issue a full refund when a member was unintentionally charged for an automatic renewal and no longer wants to remain a member. Partial refunds are not part of the normal policy.

An administrator may also issue a full refund when a recurring membership charge occurs after the member has already paid through an approved non-recurring method, such as an in-person payment or bank transfer. In that case, the administrator must disable automatic renewal and record the alternative manual payment in IDOC.

Membership refunds require administrator authorization and a reason. The original Stripe payment and all historical evidence must be preserved. A refund must not erase or falsify membership payment history.

## Seminar payments

A seminar registration may be canceled at the discretion of an administrator. A cancellation by itself does not automatically create a refund.

An administrator may issue a full refund through Stripe when approving a seminar refund. Partial refunds are not part of the normal policy.

A member-requested cancellation without an approved refund results in:

- Registration status: canceled
- Payment status: paid

After Stripe confirms an approved refund, the system records:

- Registration status: canceled
- Payment status: refunded
- The Stripe refund identifier, refunded amount, timestamp, reason, and original payment relationship

The payment record must never be relabeled as canceled or deleted. Cancellation and refund are separate facts.

## Administration and implementation

Where practical, administrators should initiate refunds from the IDOC admin interface. IDOC must then call Stripe with an idempotency key and record the result. If a refund is initiated directly in Stripe, the Stripe webhook and reconciliation process must update IDOC safely.

Refund processing must be administrator-authorized, idempotent, auditable, and safe against duplicate requests, retries, webhook replay, and partial Stripe failures.

For a seminar refund in `refund_failed`, an administrator may retry from the IDOC admin interface. If the prior Stripe attempt has a terminal provider failure with a recorded Stripe refund object and no transport uncertainty, IDOC creates a new refund attempt and a fresh Stripe idempotency key while retaining the prior attempt as historical evidence. If the prior attempt's outcome is uncertain because the request failed before provider confirmation, IDOC reuses the original idempotency key so a retry cannot create a duplicate refund. Administrators must not retry a refund marked `succeeded`; provider-side disputes, partial refunds, and unmatched refunds remain reconciliation cases requiring review.

A refunded seminar payment must never change membership entitlement, membership dates, subscriptions, or membership payment history.

If Stripe reports a refund, dispute, or chargeback that does not match the local record, IDOC must preserve the evidence and create an actionable reconciliation finding. Disputes and chargebacks remain operationally handled through Stripe unless the application later adds dedicated workflows.

## Acceptance evidence gate

The refund acceptance evidence is mapped by `docs/27-stripe-payment-acceptance-gate.json`. Its
repository checks must stay executable and unskipped; an actual hosted provider run remains required
before release and cannot be replaced by a source-code assertion or a manually inserted final row.
