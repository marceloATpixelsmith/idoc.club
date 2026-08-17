import assert from 'node:assert/strict';
import test from 'node:test';
import { computeReconciliationFindings } from '../lib/payments/reconciliation.ts';

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

for (const stripeStatus of ['active', 'trialing', 'past_due']) {
  test(`an untracked Stripe subscription with status '${stripeStatus}' is an orphaned_subscription`, () => {
    const findings = computeReconciliationFindings(
      { billingAccounts: [], subscriptions: [] },
      { customers: [], openInvoices: [], subscriptions: [{ customer: 'cus_1', id: 'sub_1', status: stripeStatus }] },
    );
    assert.deepEqual(findings, [{ externalCustomerId: 'cus_1', externalSubscriptionId: 'sub_1', kind: 'orphaned_subscription', stripeStatus }]);
  });
}

for (const stripeStatus of ['canceled', 'incomplete', 'incomplete_expired', 'unpaid']) {
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
