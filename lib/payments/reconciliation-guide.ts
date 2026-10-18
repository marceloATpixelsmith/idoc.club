// Plain-language explanations for the Stripe Reconciliation page: what each finding means to a non-technical administrator,
// why it happens, how to look into it and what to do. Keep one entry per kind allowed by `reconciliation_findings_kind_check`
// (a test fails if a kind is missing here).

export type FindingSeverity = 'act' | 'check';

export interface FindingGuide {
  kind: string;
  label: string;
  area: 'Membership' | 'Seminar';
  /** act = someone may be affected right now; check = worth a look, often harmless. */
  severity: FindingSeverity;
  /** One sentence a layperson can read at a glance. */
  plain: string;
  why: string[];
  investigate: string[];
  resolve: string[];
  /** Whether the next daily scan removes this finding by itself once the problem is gone. */
  lifecycle: 'replaced' | 'kept' | 'mixed';
}

export const LIFECYCLE_NOTE: Record<FindingGuide['lifecycle'], string> = {
  replaced: 'The next daily scan replaces this list, so it disappears by itself once the problem is fixed.',
  kept: 'Raised by a Stripe notification and kept until someone closes it: the daily scan does not remove it. After looking, select the row and use Ignore in the table\'s selection bar.',
  mixed: 'Some of these come from the daily check and disappear once fixed; the ones raised by Stripe notifications are kept until someone closes them with Ignore.',
};

export const FINDING_GUIDE: FindingGuide[] = [
  {
    kind: 'orphaned_subscription',
    lifecycle: 'replaced',
    label: 'Orphaned active Stripe subscription',
    area: 'Membership',
    severity: 'act',
    plain: 'Stripe is set to keep charging someone, but IDOC has no record of that subscription. The scan cancels these itself; one left here was deliberately not cancelled.',
    why: [
      'The scan cancels an open Stripe subscription that IDOC has no record of, so it cannot charge someone who was removed. On production this is a real cancellation in Stripe; on staging it is only simulated (the report shows it as done, Stripe is untouched). Cancelled ones never appear here.',
      'Still listed: it is less than a day old (a checkout may not have reached IDOC yet), it could not be verified, the cancellation failed (retried next scan), or the scan paused because so many were unknown to IDOC compared with IDOC\'s own records that it looks like an unpopulated database or the wrong Stripe account. The Last run box says which.',
    ],
    investigate: [
      'In the Stripe Dashboard, open Subscriptions and search for the subscription ID in the finding. Note the customer and their email.',
      'Search that email on the Members page. Is there a member, and is their membership active?',
    ],
    resolve: [
      'If the Last run box says the scan paused, check the environment first (is this the right Stripe account, and has the legacy import been done?).',
      'They should still be a member: import or create the member and link the subscription (a developer can link it; there is no admin screen), or it will be cancelled once it is a day old.',
      'They should not be billed any more: it will be cancelled by the scan; you can also cancel it in Stripe yourself.',
    ],
  },
  {
    kind: 'repeated_failure',
    lifecycle: 'replaced',
    label: 'Repeated payment failures',
    area: 'Membership',
    severity: 'act',
    plain: "A renewal invoice has failed two or more times, usually because the member's card is declining. Stripe is still retrying; this is for someone to reach out to the member.",
    why: ['An expired, replaced or cancelled card, insufficient funds, or the bank blocking the charge.'],
    investigate: [
      'In Stripe, open the invoice for the subscription ID in the finding and read the decline reason.',
      'Open the member on the Members page and check their paid-through date, so you know how long they have.',
    ],
    resolve: [
      'Contact the member and ask them to update their card (they can use Manage payment method on their own membership page). It clears by itself once the invoice is paid.',
      'If you have spoken to them and they cannot or will not update their payment, select the row and use Ignore: it stops appearing and the scan leaves it alone. Stripe keeps retrying, and if it never succeeds the subscription ends and the membership simply expires on its paid-through date. It comes back only if you restore it, or if the failures clear and happen again later.',
    ],
  },
  {
    kind: 'status_conflict',
    lifecycle: 'mixed',
    label: 'Subscription status conflict',
    area: 'Membership',
    severity: 'check',
    plain: 'A subscription in IDOC and in Stripe do not agree. The scan fixes the ordinary mismatches itself, so what is left here needs a decision.',
    why: [
      'IDOC keeps its own copy of each Stripe subscription\'s status. The daily scan compares it with Stripe and, when they differ, updates IDOC to match Stripe (Stripe is authoritative for subscription state). Membership access is never changed by this: it follows the paid-through date. Those fixed mismatches never appear here; the Last run box says how many were fixed.',
      'Still listed: Stripe uses a status IDOC cannot store, or the subscription changed while the scan was running, or the update failed. Look at the summary: it names the IDOC status and the Stripe status.',
      'A payment arrived for a membership that an administrator suspended or the member cancelled. The payment is recorded but access is deliberately not restored. This needs a decision.',
      'A Stripe notification was held back by the member communications and billing hold and never replayed. This needs a manual check.',
      '"Not found in Stripe": IDOC has the subscription open but the Stripe account being checked does not have it. The scan marks it cancelled in IDOC unless so many are missing that it looks like the wrong Stripe account, in which case it pauses and lists them here (on staging, test members created in the Stripe sandbox legitimately appear this way).',
    ],
    investigate: [
      'Open the member (View member) and look at their Payment tab: the subscription ID, status and paid-through date.',
      'Look the same subscription up in Stripe and compare the status.',
    ],
    resolve: [
      'Payment arrived for a suspended or cancelled member: either reinstate them on the Members page, or refund the payment in Stripe.',
      'Blocked by the billing hold: once the hold is released, find the event in Stripe (Developers, Events) and correct the member by hand.',
      'Still a plain status mismatch: check the paid-through date is right and suspend the member if they should not have access; a developer can look into why the update failed.',
      '"Not found in Stripe" for an imported member: note the member and ID and ask a developer to check the imported ID against the legacy export.',
    ],
  },
  {
    kind: 'unlinked_customer',
    lifecycle: 'replaced',
    label: 'Unlinked Stripe Customer',
    area: 'Membership',
    severity: 'check',
    plain: 'Stripe has a customer record that IDOC does not know about. The scan deletes the harmless ones itself; what is left here has something that needs a look.',
    why: [
      'The scan deletes a Stripe customer that IDOC has no record of when it is more than a day old, has no subscription that is not cancelled, no open invoice and no charge in the last 90 days. On production that is a real deletion in Stripe; on staging it is only simulated.',
      'Still listed: it is less than a day old, or it has a live subscription, an open invoice or a recent charge (so it may be a real payer who has not been imported), or the scan paused because so many were unknown to IDOC that it looks like an unpopulated database or the wrong Stripe account.',
    ],
    investigate: [
      'In Stripe, open Customers and search for the customer ID. Look at the email, their subscriptions and recent payments.',
      'Search the email on the Members page.',
    ],
    resolve: [
      'A real member who has not been imported: import or link them first; do not delete.',
      'Not a member and nothing recent in Stripe: the scan removes it on a later run, or a Super Admin can select it here and delete it.',
      'Paused by the safety check: confirm the environment and the import before anything else.',
    ],
  },
  {
    kind: 'pending_schedule_conflict',
    lifecycle: 'mixed',
    label: 'Pending renewal schedule conflict',
    area: 'Membership',
    severity: 'check',
    plain: "A member's chosen change for their next renewal (such as switching to automatic renewal) is not set up correctly in Stripe, so it may not happen.",
    why: [
      "The scan resolves the clear cases itself, so they never appear here: a schedule that finished running is recorded as done, and one that was cancelled or no longer exists has its waiting change dropped, leaving the member's current renewal option in place (the member is not notified).",
      "Still listed: setting up the schedule failed, the member's paid-through date changed while they were setting it up, or Stripe reports a schedule state the scan does not recognise.",
    ],
    investigate: [
      'Open the member and check what renewal option they chose.',
      "In Stripe, open the subscription schedule ID in the finding and see its status.",
    ],
    resolve: [
      'Ask the member to choose their renewal option again, or have a developer correct the schedule.',
      "Do not change the member's local billing state by hand until Stripe shows what will really happen.",
    ],
  },
  {
    kind: 'seminar_payment_conflict',
    lifecycle: 'mixed',
    label: 'Seminar payment conflict',
    area: 'Seminar',
    severity: 'act',
    plain: "A seminar registration's payment status does not match what Stripe says about the payment.",
    why: [
      'Stripe shows the payment as received but the registration is still unpaid (or the reverse).',
      'The amount or currency Stripe received differs from what the registration expected.',
      'A paid Checkout did not match the registration it was meant for, or an automatic refund after a cancellation failed.',
    ],
    investigate: [
      'On Seminar Registrations, open the registration named in the finding and note its payment status and amount.',
      'In Stripe, open the payment (payment ID or Checkout session) and compare amount, currency and status.',
    ],
    resolve: [
      'Stripe says paid but the amount or currency differs, or the registration was cancelled: decide whether to refund, and record the outcome on the registration.',
      'Registration says paid, Stripe says it failed: contact the registrant; correct the registration once you know the truth.',
      'Wrong amount: decide whether to collect the difference or refund the excess in Stripe, then note it on the registration.',
    ],
  },
  {
    kind: 'refund_conflict',
    lifecycle: 'kept',
    label: 'Refund conflict',
    area: 'Seminar',
    severity: 'act',
    plain: 'A refund was issued in Stripe for a real seminar payment outside IDOC, or it is a partial refund IDOC policy does not allow.',
    why: ['Someone issued a refund directly in the Stripe Dashboard instead of through IDOC.', 'Refunds for payments that are not seminar registrations (for example from the old site) are deliberately not listed here.'],
    investigate: ['In Stripe, open the refund and the payment it belongs to; find the registrant from the payment details.', 'Open that registration and check its payment status.'],
    resolve: ['Update the registration so it shows the refund (so money and records agree).', 'If the refund was a mistake, contact the registrant and take the appropriate step in Stripe.'],
  },
  {
    kind: 'dispute',
    lifecycle: 'kept',
    label: 'Payment dispute',
    area: 'Seminar',
    severity: 'act',
    plain: 'A cardholder has questioned a seminar charge with their bank. There is a deadline to respond.',
    why: ['The cardholder disputes the charge (not recognised, cancelled, or a mistake).'],
    investigate: ['In Stripe, open Disputes and read the reason and the evidence deadline.', 'Open the registration to see what the registrant booked and any cancellation.'],
    resolve: ['Submit evidence in Stripe before the deadline (registration confirmation, communications), or accept the dispute and mark the registration accordingly.'],
  },
  {
    kind: 'chargeback',
    lifecycle: 'kept',
    label: 'Chargeback',
    area: 'Seminar',
    severity: 'act',
    plain: 'A dispute was decided against IDOC and the money has been taken back by the bank.',
    why: ['A dispute was lost or not answered in time.'],
    investigate: ['In Stripe, open the dispute to see the outcome and amount.', 'Open the registration to see what was booked.'],
    resolve: ['Decide whether the registrant keeps their place, then update the registration; recover the fee with the registrant if appropriate.'],
  },
];

const GUIDE_BY_KIND = new Map(FINDING_GUIDE.map((entry) => [entry.kind, entry]));

export function guideForKind(kind: string): FindingGuide | undefined {
  return GUIDE_BY_KIND.get(kind);
}

export interface FindingSummaryRow {
  kind: string;
  label: string;
  area: 'Membership' | 'Seminar';
  severity: FindingSeverity;
  plain: string;
  count: number;
}

/** Counts per finding type, most urgent first, then by size. Unknown kinds are kept (as "check") so nothing is hidden. */
export function summarizeFindings(findings: Array<{ kind: string }>): FindingSummaryRow[] {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
  const rows = [...counts].map(([kind, count]): FindingSummaryRow => {
    const guide = GUIDE_BY_KIND.get(kind);
    return {
      kind, count,
      label: guide?.label ?? kind,
      area: guide?.area ?? 'Membership',
      severity: guide?.severity ?? 'check',
      plain: guide?.plain ?? 'This type has no explanation yet. Open the finding and ask a developer.',
    };
  });
  return rows.sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'act' ? -1 : 1));
}

/** The Stripe ID an administrator would search for in Stripe: the subscription or customer if recorded, otherwise the payment, refund,
 * dispute or checkout reference that webhook and seminar findings keep in `details`. */
export function stripeIdForFinding(finding: { externalSubscriptionId?: string | null; externalCustomerId?: string | null; details?: unknown }): string {
  if (finding.externalSubscriptionId) return finding.externalSubscriptionId;
  if (finding.externalCustomerId) return finding.externalCustomerId;
  const details = finding.details && typeof finding.details === 'object' ? finding.details as Record<string, unknown> : {};
  for (const key of ['paymentIntentId', 'disputeId', 'refundId', 'sessionId', 'checkoutSessionId', 'setupIntentId', 'invoiceId']) {
    const value = details[key];
    if (typeof value === 'string' && value) return value;
  }
  return '—';
}
