// Pure helpers shared by the Stripe Reconciliation page, its CSV export and the scan summary email: the Type labels and, for each finding, the plain-language
// reason the scan left it for a person. No server-only imports so the unit tests can load it.

export const RECONCILIATION_KIND_LABELS: Record<string, string> = {
  orphaned_subscription: 'Orphaned active Stripe subscription',
  repeated_failure: 'Repeated payment failures',
  status_conflict: 'Subscription status conflict',
  unlinked_customer: 'Unlinked Stripe Customer',
  pending_schedule_conflict: 'Pending renewal schedule conflict',
  seminar_payment_conflict: 'Seminar payment conflict',
  refund_conflict: 'Refund conflict',
  missing_refund: 'Missing refund',
  dispute: 'Payment dispute',
  chargeback: 'Chargeback',
};

type FindingLike = { details: unknown; kind: string };

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

/** Why this finding needs a person rather than being resolved by the scan. Written for the CSV and the summary email, so it stands on its own. */
export function manualReviewReason(finding: FindingLike): string {
  const details = asRecord(finding.details);
  const raisedByNotification = details.kind === undefined && details.source !== 'daily_seminar_scan';
  switch (finding.kind) {
    case 'repeated_failure':
      return `A renewal invoice has failed ${typeof details.attemptCount === 'number' ? `${details.attemptCount} times` : 'repeatedly'}. Stripe keeps retrying, but only the member can fix a declining card, so someone needs to contact them. If you have, and they cannot or will not update their payment, Ignore the row.`;
    case 'orphaned_subscription':
      return 'Stripe has an open subscription that IDOC has no record of, and the scan did not cancel it: it is less than a day old, could not be verified, the cancellation failed, or the scan paused because it looks like the wrong database or Stripe account. Decide whether it belongs to a real member before it charges anyone.';
    case 'unlinked_customer':
      return 'Stripe has a customer that IDOC does not know about, and the scan did not delete it: it is less than a day old, has a live subscription, an open invoice or a recent charge, or the scan paused because it looks like the wrong database or Stripe account. It may be a real payer who has not been imported.';
    case 'status_conflict':
      if (raisedByNotification) return 'A Stripe notification could not be applied to a membership automatically (for example a payment for a suspended or cancelled member, or one held back by the billing hold). It needs a decision: reinstate the member or refund the payment.';
      if (details.stripeStatus === 'missing') return 'IDOC has this subscription open but the Stripe account being checked does not have it, and the scan did not mark it cancelled because so many were missing that it looks like the wrong Stripe account. Check the environment and the imported Stripe ID.';
      return `IDOC says '${String(details.localStatus ?? 'unknown')}' and Stripe says '${String(details.stripeStatus ?? 'unknown')}'. The scan copies Stripe's status itself, so this one is a status IDOC cannot store, changed while the scan ran, or failed to update. A developer should check why.`;
    case 'pending_schedule_conflict':
      if (raisedByNotification) return 'A Stripe notification about a member\'s pending renewal change could not be applied automatically. Check the schedule in Stripe and the member\'s renewal preference before changing anything.';
      return "The member's chosen renewal change is waiting on a Stripe schedule that is in a state the scan cannot safely resolve. Inspect the schedule in Stripe and the member's renewal preference.";
    case 'seminar_payment_conflict': {
      const mismatches = Array.isArray(details.mismatches) ? details.mismatches.map(String).join('; ') : '';
      return raisedByNotification
        ? 'A Stripe notification about a seminar payment did not match the registration (amount, ownership or status), so it was not recorded automatically. Compare the Stripe payment with the registration before changing it.'
        : `Stripe and the seminar registration disagree${mismatches ? ` (${mismatches})` : ''} in a way the scan cannot settle itself, because the payment does not provably belong to this registration. Compare the Stripe payment with the registration.`;
    }
    case 'refund_conflict':
      return 'Stripe issued a refund for a seminar payment that IDOC did not initiate, or a partial refund outside IDOC policy. The registration may need to be cancelled or corrected, and the member may need to be told.';
    case 'missing_refund':
      return 'A seminar registration was cancelled but no matching refund was found in Stripe. Check whether the member is owed a refund.';
    case 'dispute':
      return 'A member disputed a seminar payment with their bank. Evidence may be due in Stripe by a deadline, so someone needs to respond.';
    case 'chargeback':
      return 'A seminar payment was charged back by the bank. Check the registration and decide how to handle the member.';
    default:
      return 'This finding needs a person to look at it.';
  }
}
