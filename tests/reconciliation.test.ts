import assert from 'node:assert/strict';
import test from 'node:test';
import { failureFollowUp, findingTypeLabel, manualReviewReason, RECONCILIATION_KIND_LABELS, stripeContactDetails } from '../lib/payments/reconciliation-report.ts';
import { checkoutBelongsToRegistration, computeReconciliationFindings, ratioBreakerTripped, summarizeFinding } from '../lib/payments/reconciliation.ts';

test('a matching local subscription with the same Stripe status produces no finding', () => {
  const findings = computeReconciliationFindings(
    { billingAccounts: [], subscriptions: [{ externalSubscriptionId: 'sub_1', profileId: 1, status: 'active' }] },
    { customers: [], openInvoices: [], subscriptions: [{ customer: 'cus_1', id: 'sub_1', status: 'active' }] },
  );
  assert.deepEqual(findings, []);
});

test('a matching local subscription with a different Stripe status is a status_conflict', () => {
  const findings = computeReconciliationFindings(
    { billingAccounts: [], subscriptions: [{ externalSubscriptionId: 'sub_1', profileId: 7, status: 'active' }] },
    { customers: [], openInvoices: [], subscriptions: [{ customer: 'cus_1', id: 'sub_1', status: 'canceled' }] },
  );
  assert.deepEqual(findings, [{ externalSubscriptionId: 'sub_1', kind: 'status_conflict', localStatus: 'active', profileId: 7, stripeStatus: 'canceled' }]);
});

for (const stripeStatus of ['active', 'trialing', 'past_due', 'incomplete']) {
  test(`an untracked Stripe subscription with status '${stripeStatus}' is an orphaned_subscription`, () => {
    const findings = computeReconciliationFindings(
      { billingAccounts: [], subscriptions: [] },
      { customers: [], openInvoices: [], subscriptions: [{ customer: 'cus_1', id: 'sub_1', status: stripeStatus }] },
    );
    assert.deepEqual(findings, [{ externalCustomerId: 'cus_1', externalSubscriptionId: 'sub_1', kind: 'orphaned_subscription', stripeStatus }]);
  });
}

for (const stripeStatus of ['canceled', 'incomplete_expired', 'unpaid']) {
  test(`an untracked Stripe subscription with status '${stripeStatus}' is not an orphan — it's not open billing`, () => {
    const findings = computeReconciliationFindings(
      { billingAccounts: [], subscriptions: [] },
      { customers: [], openInvoices: [], subscriptions: [{ customer: 'cus_1', id: 'sub_1', status: stripeStatus }] },
    );
    assert.deepEqual(findings, []);
  });
}

test('a Stripe customer with a matching local billing account produces no finding', () => {
  const findings = computeReconciliationFindings(
    { billingAccounts: [{ externalCustomerId: 'cus_1', profileId: 1 }], subscriptions: [] },
    { customers: [{ id: 'cus_1' }], openInvoices: [], subscriptions: [] },
  );
  assert.deepEqual(findings, []);
});

test('a Stripe customer with no matching local billing account is an unlinked_customer', () => {
  const findings = computeReconciliationFindings(
    { billingAccounts: [], subscriptions: [] },
    { customers: [{ id: 'cus_orphan' }], openInvoices: [], subscriptions: [] },
  );
  assert.deepEqual(findings, [{ externalCustomerId: 'cus_orphan', kind: 'unlinked_customer' }]);
});

test('an open invoice below the failure threshold produces no finding', () => {
  const findings = computeReconciliationFindings(
    { billingAccounts: [], subscriptions: [] },
    { customers: [], openInvoices: [{ attemptCount: 1, subscription: 'sub_1' }], subscriptions: [] },
  );
  assert.deepEqual(findings, []);
});

test('an open invoice at or above the failure threshold is a repeated_failure, resolving profileId from a tracked subscription', () => {
  const findings = computeReconciliationFindings(
    { billingAccounts: [], subscriptions: [{ externalSubscriptionId: 'sub_1', profileId: 9, status: 'past_due' }] },
    { customers: [], openInvoices: [{ attemptCount: 2, subscription: 'sub_1' }], subscriptions: [] },
  );
  assert.deepEqual(findings, [{ attemptCount: 2, externalSubscriptionId: 'sub_1', kind: 'repeated_failure', profileId: 9 }]);
});

test('a repeated_failure on an untracked subscription reports profileId: null', () => {
  const findings = computeReconciliationFindings(
    { billingAccounts: [], subscriptions: [] },
    { customers: [], openInvoices: [{ attemptCount: 3, subscription: 'sub_untracked' }], subscriptions: [] },
  );
  assert.deepEqual(findings, [{ attemptCount: 3, externalSubscriptionId: 'sub_untracked', kind: 'repeated_failure', profileId: null }]);
});

test('an open invoice with no subscription (a one-time-payment invoice) is ignored', () => {
  const findings = computeReconciliationFindings(
    { billingAccounts: [], subscriptions: [] },
    { customers: [], openInvoices: [{ attemptCount: 5, subscription: null }], subscriptions: [] },
  );
  assert.deepEqual(findings, []);
});

test('a custom failure threshold is respected', () => {
  const findings = computeReconciliationFindings(
    { billingAccounts: [], subscriptions: [] },
    { customers: [], openInvoices: [{ attemptCount: 2, subscription: 'sub_1' }], subscriptions: [] },
    3,
  );
  assert.deepEqual(findings, []);
});

test('all four categories can be found in the same run, independently', () => {
  const findings = computeReconciliationFindings(
    {
      billingAccounts: [{ externalCustomerId: 'cus_linked', profileId: 1 }],
      subscriptions: [{ externalSubscriptionId: 'sub_conflict', profileId: 1, status: 'active' }],
    },
    {
      customers: [{ id: 'cus_linked' }, { id: 'cus_unlinked' }],
      openInvoices: [{ attemptCount: 2, subscription: 'sub_conflict' }],
      subscriptions: [
        { customer: 'cus_linked', id: 'sub_conflict', status: 'past_due' },
        { customer: 'cus_orphan', id: 'sub_orphan', status: 'active' },
      ],
    },
  );
  const kinds = findings.map((finding) => finding.kind).sort();
  assert.deepEqual(kinds, ['orphaned_subscription', 'repeated_failure', 'status_conflict', 'unlinked_customer']);
});

test('a missing or canceled pending Subscription Schedule is actionable and never silently repaired', () => {
  const missing = computeReconciliationFindings(
    { billingAccounts: [], renewalPreferences: [{ externalSubscriptionScheduleId: 'sub_sched_missing', profileId: 41, transitionState: 'pending_activation' }], subscriptions: [] },
    { customers: [], openInvoices: [], schedules: [], subscriptions: [] },
  );
  assert.deepEqual(missing, [{ externalSubscriptionId: 'sub_sched_missing', kind: 'pending_schedule_conflict', profileId: 41, stripeStatus: 'missing' }]);
  assert.match(summarizeFinding(missing[0]), /inspect before changing local billing state/);
});

test('open local subscriptions missing from Stripe are reported only when the option is on', () => {
  const local = { billingAccounts: [{ externalCustomerId: 'cus_1', profileId: 1 }], subscriptions: [{ externalSubscriptionId: 'sub_gone', profileId: 1, status: 'active' }, { externalSubscriptionId: 'sub_here', profileId: 2, status: 'active' }, { externalSubscriptionId: 'sub_old', profileId: 3, status: 'canceled' }] };
  const stripe = { customers: [{ id: 'cus_1' }], openInvoices: [], subscriptions: [{ customer: 'cus_2', id: 'sub_here', status: 'active' }] };
  assert.deepEqual(computeReconciliationFindings(local, stripe), []);
  const findings = computeReconciliationFindings(local, stripe, 2, { reportLocalMissingInStripe: true });
  assert.deepEqual(findings, [{ externalSubscriptionId: 'sub_gone', kind: 'status_conflict', localStatus: 'active', profileId: 1, stripeStatus: 'missing' }]);
  assert.match(summarizeFinding(findings[0]), /has no subscription with that ID/);
  assert.equal(findingTypeLabel({ details: findings[0], kind: 'status_conflict' }), 'Subscription missing from Stripe');
  assert.equal(findingTypeLabel({ details: { kind: 'status_conflict', stripeStatus: 'paused' }, kind: 'status_conflict' }), 'Subscription status conflict');
});

test('the wrong-database guard trips only when many items are a large share of everything compared', () => {
  assert.equal(ratioBreakerTripped(5, 6), false, 'five or fewer is always a normal exception');
  assert.equal(ratioBreakerTripped(11, 13), true, 'eleven against an almost empty database trips');
  assert.equal(ratioBreakerTripped(11, 11 + 5000), false, 'eleven against a populated database is a normal exception');
  assert.equal(ratioBreakerTripped(6, 6 + 24), false, 'exactly 20 percent does not trip');
  assert.equal(ratioBreakerTripped(7, 7 + 20), true);
  assert.equal(ratioBreakerTripped(10, 0), false, 'an empty population never divides by zero');
});

const ownedSession = { amount_total: 4500, currency: 'eur', customer: null, id: 'cs_1', metadata: { amountCents: '4500', currency: 'EUR', profileId: '7', registrationId: '3', seminarId: '9' }, payment_intent: 'pi_1', payment_status: 'paid' };
const ownedRegistration = { customerId: null, expectedAmountCents: 4500, id: 3, profileId: 7, seminarId: 9, stripeCheckoutSessionId: 'cs_1', stripePaymentIntentId: null };

test('a Checkout that provably belongs to the registration passes the ownership check', () => {
  assert.equal(checkoutBelongsToRegistration(ownedSession, ownedRegistration), true);
});

for (const [name, session, registration] of [
  ['another profile', { ...ownedSession, metadata: { ...ownedSession.metadata, profileId: '8' } }, ownedRegistration],
  ['another registration', { ...ownedSession, metadata: { ...ownedSession.metadata, registrationId: '4' } }, ownedRegistration],
  ['another seminar', { ...ownedSession, metadata: { ...ownedSession.metadata, seminarId: '10' } }, ownedRegistration],
  ['a session the registration did not create', { ...ownedSession, id: 'cs_other' }, ownedRegistration],
  ['a different PaymentIntent than the one stored', ownedSession, { ...ownedRegistration, stripePaymentIntentId: 'pi_other' }],
  ['a different Stripe customer', { ...ownedSession, customer: 'cus_other' }, ownedRegistration],
  ['an unpaid session', { ...ownedSession, payment_status: 'unpaid' }, ownedRegistration],
  ['metadata amount that disagrees', { ...ownedSession, metadata: { ...ownedSession.metadata, amountCents: '4000' } }, ownedRegistration],
  ['a non-EUR currency', { ...ownedSession, currency: 'usd' }, ownedRegistration],
] as const) {
  test(`the ownership check rejects ${name}`, () => {
    assert.equal(checkoutBelongsToRegistration(session, registration), false);
  });
}

test('every reconciliation Type has a label and its own reason for manual review', () => {
  const reasons = new Set<string>();
  for (const kind of Object.keys(RECONCILIATION_KIND_LABELS)) {
    const reason = manualReviewReason({ details: { kind }, kind });
    assert.ok(reason.length > 40, kind);
    reasons.add(reason);
  }
  assert.equal(reasons.size, Object.keys(RECONCILIATION_KIND_LABELS).length);
  assert.match(manualReviewReason({ details: { attemptCount: 3, kind: 'repeated_failure' }, kind: 'repeated_failure' }), /failed 3 times/);
  assert.match(manualReviewReason({ details: { kind: 'status_conflict', localStatus: 'active', stripeStatus: 'paused' }, kind: 'status_conflict' }), /'active'.*'paused'/);
  assert.notEqual(manualReviewReason({ details: {}, kind: 'status_conflict' }), manualReviewReason({ details: { kind: 'status_conflict', stripeStatus: 'paused' }, kind: 'status_conflict' }));
});

test('a repeated failure on a subscription IDOC does not know keeps the contact details Stripe holds', () => {
  const findings = computeReconciliationFindings(
    { billingAccounts: [], subscriptions: [] },
    { customers: [], openInvoices: [{ attemptCount: 5, customerEmail: 'legacy@example.test', customerName: 'Legacy Member', subscription: 'sub_legacy' }, { attemptCount: 3, subscription: 'sub_bare' }], subscriptions: [] },
  );
  assert.deepEqual(findings, [
    { attemptCount: 5, customerEmail: 'legacy@example.test', customerName: 'Legacy Member', externalSubscriptionId: 'sub_legacy', kind: 'repeated_failure', profileId: null },
    { attemptCount: 3, externalSubscriptionId: 'sub_bare', kind: 'repeated_failure', profileId: null },
  ]);
  assert.deepEqual(stripeContactDetails(findings[0]), { email: 'legacy@example.test', name: 'Legacy Member' });
  assert.deepEqual(stripeContactDetails(findings[1]), { email: '', name: '' });
  assert.match(manualReviewReason({ details: findings[0], kind: 'repeated_failure' }), /no record of/);
});

test('orphaned subscriptions and unlinked customers keep the contact details Stripe holds, and repeated failures say why and when Stripe retries', () => {
  const findings = computeReconciliationFindings(
    { billingAccounts: [], subscriptions: [] },
    {
      customers: [{ email: 'orphan@example.test', id: 'cus_orphan', name: 'Orphan Holder' }, { id: 'cus_bare' }],
      openInvoices: [{ attemptCount: 3, nextPaymentAttempt: Date.UTC(2026, 10, 3) / 1000, subscription: 'sub_late' }],
      subscriptions: [{ customer: 'cus_orphan', id: 'sub_orphan', status: 'active' }],
    },
  );
  assert.deepEqual(findings.find((finding) => finding.kind === 'orphaned_subscription'), { customerEmail: 'orphan@example.test', customerName: 'Orphan Holder', externalCustomerId: 'cus_orphan', externalSubscriptionId: 'sub_orphan', kind: 'orphaned_subscription', stripeStatus: 'active' });
  assert.deepEqual(findings.filter((finding) => finding.kind === 'unlinked_customer'), [
    { customerEmail: 'orphan@example.test', customerName: 'Orphan Holder', externalCustomerId: 'cus_orphan', kind: 'unlinked_customer' },
    { externalCustomerId: 'cus_bare', kind: 'unlinked_customer' },
  ]);
  const failure = findings.find((finding) => finding.kind === 'repeated_failure');
  assert.ok(failure && failure.kind === 'repeated_failure');
  assert.equal(failure.nextRetryAt, '2026-11-03T00:00:00.000Z');
  const declined = { ...failure, declineReason: 'Your card has insufficient funds.' };
  assert.equal(summarizeFinding(declined), 'Subscription sub_late has an open invoice with 3 failed payment attempts. Last decline: Your card has insufficient funds. Next retry: 2026-11-03.');
  assert.match(summarizeFinding({ ...failure, nextRetryAt: undefined }), /no further retry scheduled/);
  assert.deepEqual(failureFollowUp(declined), { lastDecline: 'Your card has insufficient funds.', nextRetry: '2026-11-03' });
  assert.deepEqual(failureFollowUp({}), { lastDecline: '', nextRetry: '' });
});

test('the missing-refund type is gone from the labels', () => {
  assert.equal('missing_refund' in RECONCILIATION_KIND_LABELS, false);
});
