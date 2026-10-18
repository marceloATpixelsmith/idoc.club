import assert from 'node:assert/strict';
import test from 'node:test';
import { computeReconciliationFindings, planOrphanCancellations, summarizeFinding } from '../lib/payments/reconciliation.ts';

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

test('local subscriptions missing from Stripe are reported only when the rehearsal option is on', () => {
  const local = { billingAccounts: [{ externalCustomerId: 'cus_1', profileId: 1 }], subscriptions: [{ externalSubscriptionId: 'sub_gone', profileId: 1, status: 'active' }, { externalSubscriptionId: 'sub_here', profileId: 2, status: 'active' }] };
  const stripe = { customers: [{ id: 'cus_1' }], openInvoices: [], subscriptions: [{ customer: 'cus_2', id: 'sub_here', status: 'active' }] };
  assert.deepEqual(computeReconciliationFindings(local, stripe), []);
  const findings = computeReconciliationFindings(local, stripe, 2, { reportLocalMissingInStripe: true });
  assert.deepEqual(findings, [{ externalSubscriptionId: 'sub_gone', kind: 'status_conflict', localStatus: 'active', profileId: 1, stripeStatus: 'missing' }]);
  assert.match(summarizeFinding(findings[0]), /was not found in Stripe/);
});

const NOW = new Date('2026-10-20T12:00:00Z');
const orphan = (id: string, ageHours: number | null, status = 'active') => ({ createdSeconds: ageHours === null ? null : NOW.getTime() / 1000 - ageHours * 3600, customer: 'cus_1', id, status });
const flaggedHoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600 * 1000);

test('an orphan older than a day that the previous snapshot already flagged is cancelled', () => {
  const plan = planOrphanCancellations([orphan('sub_old', 48)], new Map([['sub_old', flaggedHoursAgo(24)]]), NOW);
  assert.deepEqual(plan.cancel.map((entry) => entry.id), ['sub_old']);
  assert.equal(plan.tripped, false);
});

test('a first-time orphan is deferred, however old: it must be seen in two snapshots', () => {
  const plan = planOrphanCancellations([orphan('sub_old', 48)], new Map(), NOW);
  assert.deepEqual(plan.cancel, []);
  assert.deepEqual(plan.deferred.map((entry) => entry.id), ['sub_old']);
});

test('an orphan flagged only minutes ago (back-to-back manual scans) is deferred', () => {
  const plan = planOrphanCancellations([orphan('sub_old', 48)], new Map([['sub_old', flaggedHoursAgo(0.2)]]), NOW);
  assert.deepEqual(plan.cancel, []);
});

test('a subscription younger than 24 hours is never cancelled, even if flagged before', () => {
  const plan = planOrphanCancellations([orphan('sub_new', 3)], new Map([['sub_new', flaggedHoursAgo(24)]]), NOW);
  assert.deepEqual(plan.cancel, []);
});

test('an orphan with no known creation time is not cancelled', () => {
  const plan = planOrphanCancellations([orphan('sub_unknown', null)], new Map([['sub_unknown', flaggedHoursAgo(24)]]), NOW);
  assert.deepEqual(plan.cancel, []);
});

test('more than five orphans in one run trips the circuit breaker and cancels none', () => {
  const orphans = Array.from({ length: 6 }, (_, index) => orphan(`sub_${index}`, 72));
  const plan = planOrphanCancellations(orphans, new Map(orphans.map((entry) => [entry.id, flaggedHoursAgo(24)])), NOW);
  assert.equal(plan.tripped, true);
  assert.deepEqual(plan.cancel, []);
  assert.equal(plan.deferred.length, 6);
});

test('exactly five qualifying orphans are still cancelled', () => {
  const orphans = Array.from({ length: 5 }, (_, index) => orphan(`sub_${index}`, 72));
  const plan = planOrphanCancellations(orphans, new Map(orphans.map((entry) => [entry.id, flaggedHoursAgo(24)])), NOW);
  assert.equal(plan.tripped, false);
  assert.equal(plan.cancel.length, 5);
});
