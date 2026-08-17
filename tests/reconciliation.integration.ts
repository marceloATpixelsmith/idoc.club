import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { getLastReconciliationRun, listReconciliationFindings } from '../lib/membership/data-access.ts';
import { runReconciliationScan, type ReconciliationStripeClient } from '../lib/payments/reconciliation-scan.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { GET as reconciliationScanCron } from '../app/api/cron/reconciliation-scan/route.ts';
import { adminUser, asAdmin, closeHarness, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

function fakeStripeClient(data: {
  customers?: Array<{ id: string }>;
  invoices?: Array<{ attempt_count: number; id: string; subscription: string | null }>;
  subscriptions?: Array<{ customer: string; id: string; status: string }>;
}): ReconciliationStripeClient {
  return {
    customers: { list: async () => ({ data: data.customers ?? [], has_more: false }) },
    invoices: { list: async () => ({ data: data.invoices ?? [], has_more: false }) },
    subscriptions: { list: async () => ({ data: data.subscriptions ?? [], has_more: false }) },
  };
}

test('runReconciliationScan persists findings and a completed run row', async () => {
  const result = await runReconciliationScan(fakeStripeClient({ customers: [{ id: 'cus_orphan' }], subscriptions: [] }));
  assert.equal(result.findingsCount, 1);

  const [run] = await sql`select status, findings_count as "findingsCount" from idoc.reconciliation_runs`;
  assert.equal(run.status, 'completed');
  assert.equal(run.findingsCount, 1);

  const findings = await sql`select kind, external_customer_id as "externalCustomerId" from idoc.reconciliation_findings`;
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'unlinked_customer');
  assert.equal(findings[0].externalCustomerId, 'cus_orphan');
});

test('a second run replaces the findings set entirely', async () => {
  await runReconciliationScan(fakeStripeClient({ customers: [{ id: 'cus_first' }] }));
  await runReconciliationScan(fakeStripeClient({ customers: [{ id: 'cus_second' }] }));

  const findings = await sql`select external_customer_id as "externalCustomerId" from idoc.reconciliation_findings`;
  assert.equal(findings.length, 1);
  assert.equal(findings[0].externalCustomerId, 'cus_second');

  const runs = await sql`select count(*)::int as count from idoc.reconciliation_runs`;
  assert.equal(runs[0].count, 2, 'each run appends its own heartbeat row rather than replacing it');
});

test('a run finding nothing still records a completed run with zero findings', async () => {
  const result = await runReconciliationScan(fakeStripeClient({}));
  assert.equal(result.findingsCount, 0);
  const [run] = await sql`select status, findings_count as "findingsCount" from idoc.reconciliation_runs`;
  assert.equal(run.status, 'completed');
  assert.equal(run.findingsCount, 0);
});

test('a throwing Stripe client leaves the prior findings snapshot untouched but records a failed run, and rethrows', async () => {
  await runReconciliationScan(fakeStripeClient({ customers: [{ id: 'cus_prior' }] }));

  const throwingClient: ReconciliationStripeClient = {
    customers: { list: async () => { throw new Error('stripe unavailable'); } },
    invoices: { list: async () => ({ data: [], has_more: false }) },
    subscriptions: { list: async () => ({ data: [], has_more: false }) },
  };
  await assert.rejects(runReconciliationScan(throwingClient), /stripe unavailable/);

  const findings = await sql`select external_customer_id as "externalCustomerId" from idoc.reconciliation_findings`;
  assert.equal(findings.length, 1, 'the last known-good snapshot must survive a failed run');
  assert.equal(findings[0].externalCustomerId, 'cus_prior');

  const runs = await sql`select status, error_message as "errorMessage" from idoc.reconciliation_runs order by id`;
  assert.equal(runs.length, 2);
  assert.equal(runs[0].status, 'completed');
  assert.equal(runs[1].status, 'failed');
  assert.match(runs[1].errorMessage, /stripe unavailable/);
});

test('the cron route returns 500 and does not crash when the batch throws', async () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'invalid-too-short';
  try {
    const request = new Request('http://localhost/api/cron/reconciliation-scan', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const response = await reconciliationScanCron(request);
    assert.equal(response.status, 500);
  } finally {
    process.env.STRIPE_SECRET_KEY = originalKey;
  }
  const runs = await sql`select status from idoc.reconciliation_runs`;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'failed');
});

test('the cron route rejects a request without the correct shared secret', async () => {
  const request = new Request('http://localhost/api/cron/reconciliation-scan');
  const response = await reconciliationScanCron(request);
  assert.equal(response.status, 401);
});

test('listReconciliationFindings and getLastReconciliationRun are reachable by an administrator', async () => {
  const admin = await adminUser();
  await runReconciliationScan(fakeStripeClient({ customers: [{ id: 'cus_visible' }] }));

  const findings = await asAdmin(admin.id, () => listReconciliationFindings());
  assert.equal(findings.length, 1);
  const run = await asAdmin(admin.id, () => getLastReconciliationRun());
  assert.equal(run?.status, 'completed');
});

test('listReconciliationFindings and getLastReconciliationRun reject a non-administrator', async () => {
  const nonAdmin = await createUser();
  await assert.rejects(withTestMembershipBoundary({ actor: { id: nonAdmin.id, roles: [] } }, () => listReconciliationFindings()));
  await assert.rejects(withTestMembershipBoundary({ actor: { id: nonAdmin.id, roles: [] } }, () => getLastReconciliationRun()));
});

test('getLastReconciliationRun returns null when no run has ever completed', async () => {
  const admin = await adminUser();
  const run = await asAdmin(admin.id, () => getLastReconciliationRun());
  assert.equal(run, null);
});

test('a status_conflict finding resolves the member profile via the local subscription', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values (${profile.id}, 'sub_conflict', 'price_fixture', 'active', current_date + 30, false)`;

  await runReconciliationScan(fakeStripeClient({ subscriptions: [{ customer: 'cus_x', id: 'sub_conflict', status: 'canceled' }] }));

  const findings = await asAdmin(admin.id, () => listReconciliationFindings());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'status_conflict');
  assert.equal(findings[0].profileId, profile.id);
});
