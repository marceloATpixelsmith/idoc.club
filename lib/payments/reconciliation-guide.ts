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
  kept: 'Raised by a Stripe notification and kept after you fix it: the daily scan does not remove it and there is no close button yet. Note what you did and treat it as handled; a developer can clear it.',
  mixed: 'Some of these come from the daily check and disappear once fixed; the ones raised by Stripe notifications are kept after you fix them (no close button yet), so treat those as handled once dealt with.',
};

export const FINDING_GUIDE: FindingGuide[] = [
  {
    kind: 'orphaned_subscription',
    lifecycle: 'replaced',
    label: 'Orphaned active Stripe subscription',
    area: 'Membership',
    severity: 'act',
    plain: 'Stripe is set to keep charging someone, but IDOC has no record of that subscription.',
    why: [
      'A member signed up or was billed outside IDOC (for example a subscription carried over from the old WordPress site that has not been imported).',
      'The subscription belongs to someone who was removed or deleted here but never cancelled in Stripe.',
      'The link between the member and the subscription was never saved here.',
    ],
    investigate: [
      'In the Stripe Dashboard, open Subscriptions and search for the subscription ID in the finding. Note the customer and their email.',
      'Search that email on the Members page. Is there a member, and is their membership active?',
    ],
    resolve: [
      'Production cancels these automatically: an open Stripe subscription that IDOC has no record of is cancelled once it is more than a day old and has appeared on two scans in a row, and each cancellation is recorded in the audit log. Nothing needs doing for those.',
      'If more than five turn up in one scan, nothing is cancelled and an alert is raised, because that usually means the wrong database or Stripe account is being compared. Check the environment before doing anything else.',
      'They should still be a member: make sure the member exists and has the right paid-through date (Members page, correct entitlement), and ask a developer to link the subscription ID before the next scans, or it will be cancelled.',
      'On staging nothing is cancelled; the finding is for information only.',
    ],
  },
  {
    kind: 'repeated_failure',
    lifecycle: 'replaced',
    label: 'Repeated payment failures',
    area: 'Membership',
    severity: 'act',
    plain: "A renewal invoice has failed two or more times, usually because the member's card is declining.",
    why: ['An expired, replaced or cancelled card, insufficient funds, or the bank blocking the charge.'],
    investigate: [
      'In Stripe, open the invoice for the subscription ID in the finding and read the decline reason.',
      'Open the member on the Members page and check their paid-through date, so you know how long they have.',
    ],
    resolve: [
      'Contact the member and ask them to update their card (they can use Manage payment method on their own membership page).',
      'Stripe keeps retrying automatically. If it never succeeds the subscription ends and the membership simply expires on its paid-through date; nothing else needs fixing.',
    ],
  },
  {
    kind: 'status_conflict',
    lifecycle: 'replaced',
    label: 'Subscription status conflict',
    area: 'Membership',
    severity: 'check',
    plain: "IDOC and Stripe disagree about a subscription: one says it is active and the other says it is not (or it cannot be found).",
    why: [
      'Stripe changed the subscription (cancelled, past due, paused) and the update has not reached IDOC, or was blocked on purpose.',
      'A payment arrived for a membership that an administrator had suspended or cancelled: the payment is recorded but access is deliberately not restored.',
      "Reported as \"not found in Stripe\": the subscription ID stored here does not exist in the Stripe account being checked. On staging this is expected for sandbox test members; for an imported member it means the imported ID is wrong.",
    ],
    investigate: [
      "Open the member (View member) and look at their Payment tab: the subscription ID, status and paid-through date.",
      'Look the same subscription up in Stripe and compare the status.',
    ],
    resolve: [
      'Stripe is the authority for billing. If Stripe says cancelled or ended and IDOC says active, suspend the member or correct their paid-through date on the Members page.',
      'If a payment came in for a suspended or cancelled member, decide whether to reinstate them (Members page) or refund the payment in Stripe.',
      '"Not found in Stripe" for an imported member: note the member and ID and ask a developer to check the imported ID against the legacy export.',
    ],
  },
  {
    kind: 'unlinked_customer',
    lifecycle: 'replaced',
    label: 'Unlinked Stripe Customer',
    area: 'Membership',
    severity: 'check',
    plain: 'Stripe has a customer record that IDOC does not know about. Often harmless on its own.',
    why: [
      'Someone who paid or enquired through the old site or the Stripe Dashboard and is not (yet) a member here.',
      'On staging in rehearsal mode: every real customer in live Stripe who has not been imported shows up here, so a long list is normal before the import.',
      'A member whose billing link was never saved (or whose email update in Stripe failed).',
    ],
    investigate: [
      'In Stripe, open Customers and search for the customer ID. Look at the email and whether they have an active subscription.',
      'Search the email on the Members page.',
    ],
    resolve: [
      'In production a Super Admin can delete them all with the Delete unlinked customers button on this page. Customers with a live subscription, an open invoice or a charge in the last 90 days are skipped automatically, every deletion is logged, and a CSV of what was processed can be downloaded.',
      'Active subscription: it will also appear as an orphaned subscription; handle it there.',
      'They are a member here but the link is missing: ask a developer to link the customer before deleting anything; there is no admin screen for that.',
    ],
  },
  {
    kind: 'pending_schedule_conflict',
    lifecycle: 'replaced',
    label: 'Pending renewal schedule conflict',
    area: 'Membership',
    severity: 'check',
    plain: "A member's chosen change for their next renewal (such as a different plan) is not set up correctly in Stripe, so it may not happen.",
    why: ["The renewal change was scheduled in Stripe and the schedule has since been cancelled, completed early, or cannot be found."],
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
      'Stripe says paid, registration unpaid: record the payment on the registration with the Stripe Payment ID as evidence.',
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
    kind: 'missing_refund',
    lifecycle: 'kept',
    label: 'Missing refund',
    area: 'Seminar',
    severity: 'check',
    plain: 'IDOC expected a refund that Stripe does not show.',
    why: ['This type is reserved; the system does not currently raise it, so you should not normally see it.'],
    investigate: ['Open the registration and the matching Stripe payment and compare refund status.'],
    resolve: ['If the refund is genuinely missing, issue it in Stripe, then correct the registration.'],
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
