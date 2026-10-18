import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { getLastReconciliationRun, listReconciliationFindings } from '../lib/membership/data-access.ts';
import { deleteUnlinkedCustomers, markFindingsHandled } from '../lib/payments/reconciliation-remediation.ts';
import { runReconciliationScan, type ReconciliationStripeClient } from '../lib/payments/reconciliation-scan.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { GET as reconciliationScanCron } from '../app/api/cron/reconciliation-scan/route.ts';
import { adminUser, asAdmin, closeHarness, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

// CRON_SECRET must be set here, not inherited: each *.integration.ts file runs in its own isolated
// process under node:test's multi-file runner, so a sibling file's env-var assignment (e.g.
// account-delivery-worker.integration.ts's own RAW_SECRET) never reaches this file — matching the
// established convention every other file that invokes a real cron route's GET handler already
// follows.
const RAW_SECRET = 'integration-cron-secret-at-least-32-characters';

beforeEach(async () => {
  process.env.CRON_SECRET = RAW_SECRET;
  await resetIdoc();
});
after(closeHarness);

function fakeStripeClient(data: {
  customers?: Array<{ id: string }>;
  // Deliberately shaped exactly like the real Stripe Invoice under API version 2025-04-30.basil —
  // subscription lives at invoice.parent.subscription_details.subscription, not a top-level field —
  // so this fixture exercises the same nested-field read runReconciliationScan performs, catching
  // any regression back to a flat (wrong) shape.
  invoices?: Array<{ attempt_count: number; id: string; parent: { subscription_details: { subscription: string } | null } | null }>;
  subscriptions?: Array<{ cancel_at_period_end?: boolean; created?: number; customer: string; id: string; items?: { data: Array<{ current_period_end?: number; price?: { id: string } }> }; status: string }>;
}): ReconciliationStripeClient {
  return {
    customers: { list: async () => ({ data: data.customers ?? [], has_more: false }) },
    invoices: { list: async () => ({ data: data.invoices ?? [], has_more: false }) },
    subscriptions: { list: async () => ({ data: data.subscriptions ?? [], has_more: false }) },
  };
}

function invoiceFixture(id: string, attemptCount: number, subscriptionId: string | null) {
  return { attempt_count: attemptCount, id, parent: subscriptionId ? { subscription_details: { subscription: subscriptionId } } : null };
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
    const request = new Request('http://localhost/api/cron/reconciliation-scan', { headers: { authorization: `Bearer ${RAW_SECRET}` } });
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

  await runReconciliationScan(fakeStripeClient({ subscriptions: [{ customer: 'cus_x', id: 'sub_conflict', status: 'paused' }] }));

  const findings = await asAdmin(admin.id, () => listReconciliationFindings());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'status_conflict');
  assert.equal(findings[0].profileId, profile.id);
});

test('a repeated_failure finding reads the subscription ID from invoice.parent.subscription_details, not a flat field', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values (${profile.id}, 'sub_failing', 'price_fixture', 'past_due', current_date + 30, false)`;

  await runReconciliationScan(fakeStripeClient({
    invoices: [invoiceFixture('in_1', 2, 'sub_failing'), invoiceFixture('in_2', 1, 'sub_failing')],
    subscriptions: [{ customer: 'cus_x', id: 'sub_failing', status: 'past_due' }],
  }));

  const findings = await asAdmin(admin.id, () => listReconciliationFindings());
  const repeatedFailure = findings.find((finding) => finding.kind === 'repeated_failure');
  assert.ok(repeatedFailure, 'a repeated_failure finding must be produced from the 2-attempt invoice');
  assert.equal(repeatedFailure?.externalSubscriptionId, 'sub_failing');
  assert.equal(repeatedFailure?.profileId, profile.id);
});

test('an invoice with no parent (a one-time-payment invoice) is not treated as a repeated failure', async () => {
  const admin = await adminUser();
  await runReconciliationScan(fakeStripeClient({ invoices: [invoiceFixture('in_one_time', 5, null)] }));
  const findings = await asAdmin(admin.id, () => listReconciliationFindings());
  assert.deepEqual(findings.filter((finding) => finding.kind === 'repeated_failure'), []);
});

// --- Automatic cancellation of orphaned subscriptions ---------------------------------------------------------------------

const NOW = new Date();
const hoursBefore = (hours: number) => Math.floor(NOW.getTime() / 1000) - hours * 3600;

function remediationClient(statuses: Record<string, string> = {}) {
  const cancelled: string[] = [];
  const client = {
    customers: { del: async () => ({}), retrieve: async (id: string) => ({ id }) },
    subscriptions: {
      cancel: async (id: string) => { cancelled.push(id); return {}; },
      retrieve: async (id: string) => ({ id, status: statuses[id] ?? 'active' }),
    },
  };
  return { cancelled, client };
}

async function seedPreviousOrphanFlag(id: string, hoursAgo: number) {
  await sql`insert into idoc.reconciliation_findings(kind, external_subscription_id, external_customer_id, summary, created_at)
    values ('orphaned_subscription', ${id}, 'cus_x', 'seeded', now() - make_interval(hours => ${hoursAgo}))`;
}

test('a confirmed, day-old orphaned subscription is cancelled, audit-logged and leaves the findings', async () => {
  await seedPreviousOrphanFlag('sub_orphan', 30);
  const { cancelled, client } = remediationClient();
  const result = await runReconciliationScan(
    fakeStripeClient({ subscriptions: [{ created: hoursBefore(72), customer: 'cus_x', id: 'sub_orphan', status: 'active' }] }),
    { now: NOW, remediationClient: client },
  );
  assert.deepEqual(cancelled, ['sub_orphan']);
  assert.equal(result.findingsCount, 0);
  const audit = await sql`select entity_id as "entityId" from idoc.audit_log where action = 'reconciliation.orphan_subscription_canceled'`;
  assert.deepEqual(audit.map((row) => row.entityId), ['sub_orphan']);
});

test('a first-time orphan is reported but not cancelled', async () => {
  const { cancelled, client } = remediationClient();
  const result = await runReconciliationScan(
    fakeStripeClient({ subscriptions: [{ created: hoursBefore(72), customer: 'cus_x', id: 'sub_orphan', status: 'active' }] }),
    { now: NOW, remediationClient: client },
  );
  assert.deepEqual(cancelled, []);
  assert.equal(result.findingsCount, 1);
});

test('an orphan whose local record has appeared since is never cancelled', async () => {
  const member = await createUser();
  const profile = await createProfile(member.id);
  await seedPreviousOrphanFlag('sub_late', 30);
  const { cancelled, client } = remediationClient();
  // The scan's own snapshot of local subscriptions is read first, so insert the row the way a webhook racing the scan would: after the previous snapshot.
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values (${profile.id}, 'sub_late', 'price_fixture', 'active', current_date + 30, false)`;
  await runReconciliationScan(
    fakeStripeClient({ subscriptions: [{ created: hoursBefore(72), customer: 'cus_x', id: 'sub_late', status: 'active' }] }),
    { now: NOW, remediationClient: client },
  );
  assert.deepEqual(cancelled, []);
});

test('more than five orphans cancel none and write a pause record', async () => {
  const ids = Array.from({ length: 6 }, (_, index) => `sub_many_${index}`);
  for (const id of ids) await seedPreviousOrphanFlag(id, 30);
  const { cancelled, client } = remediationClient();
  const result = await runReconciliationScan(
    fakeStripeClient({ subscriptions: ids.map((id) => ({ created: hoursBefore(72), customer: 'cus_x', id, status: 'active' })) }),
    { now: NOW, remediationClient: client },
  );
  assert.deepEqual(cancelled, []);
  assert.equal(result.findingsCount, 6);
  const paused = await sql`select 1 from idoc.audit_log where action = 'reconciliation.orphan_cancel_paused'`;
  assert.equal(paused.length, 1);
});

test('without the production gate (no override), the scan never cancels anything', async () => {
  await seedPreviousOrphanFlag('sub_orphan', 30);
  const result = await runReconciliationScan(
    fakeStripeClient({ subscriptions: [{ created: hoursBefore(72), customer: 'cus_x', id: 'sub_orphan', status: 'active' }] }),
  );
  assert.equal(result.findingsCount, 1);
});

// --- Refunds and disputes only count as seminar findings for real seminar payments ---------------------------------------

test('stale refund findings for payments that are not seminar registrations are removed by the next scan; real ones stay', async () => {
  await sql`insert into idoc.reconciliation_findings(kind, summary, details) values
    ('refund_conflict', 'Stripe reported a refund without a matching local seminar payment.', '{"paymentIntentId":"pi_legacy","refundId":"re_1","status":"succeeded"}'),
    ('refund_conflict', 'A Stripe-initiated seminar refund requires administrator review.', '{"amount":5000,"expectedAmount":5000,"refundId":"re_2"}')`;
  await runReconciliationScan(fakeStripeClient({}));
  const remaining = await sql`select details ->> 'refundId' as "refundId" from idoc.reconciliation_findings where kind = 'refund_conflict'`;
  assert.deepEqual(remaining.map((row) => row.refundId), ['re_2']);
});

// --- Unlinked customer cleanup -----------------------------------------------------------------------------------------------

function cleanupClient(options: { charges?: string[]; invoices?: string[]; subscriptions?: Record<string, Array<{ id: string; status: string }>>; onRetrieve?: (id: string) => Promise<void> } = {}) {
  const deleted: string[] = [];
  const client = {
    charges: { list: async (params: { customer: string }) => ({ data: options.charges?.includes(params.customer) ? [{ id: 'ch_1' }] : [] }) },
    customers: { del: async (id: string) => { deleted.push(id); return {}; }, retrieve: async (id: string) => { await options.onRetrieve?.(id); return { created: 1_700_000_000, email: `${id}@example.test`, id, name: id }; } },
    invoices: { list: async (params: { customer: string }) => ({ data: options.invoices?.includes(params.customer) ? [{ id: 'in_1' }] : [] }) },
    subscriptions: {
      cancel: async () => ({}),
      list: async (params: { customer: string; starting_after?: string }) => {
        const all = options.subscriptions?.[params.customer] ?? [];
        const start = params.starting_after ? all.findIndex((entry) => entry.id === params.starting_after) + 1 : 0;
        const data = all.slice(start, start + 2);
        return { data, has_more: start + 2 < all.length };
      },
      retrieve: async (id: string) => ({ id, status: 'active' }),
    },
  };
  return { client, deleted };
}

async function seedUnlinked(...ids: string[]) {
  for (const id of ids) await sql`insert into idoc.reconciliation_findings(kind, external_customer_id, summary) values ('unlinked_customer', ${id}, 'seeded')`;
}

test('cleanup deletes clean unlinked customers and skips those with live subscriptions (even on a later page), open invoices or recent charges', async () => {
  const admin = await adminUser();
  await seedUnlinked('cus_clean', 'cus_live_late', 'cus_invoice', 'cus_charged');
  const { client, deleted } = cleanupClient({
    charges: ['cus_charged'], invoices: ['cus_invoice'],
    subscriptions: { cus_live_late: [{ id: 's1', status: 'canceled' }, { id: 's2', status: 'canceled' }, { id: 's3', status: 'active' }] },
  });
  const result = await deleteUnlinkedCustomers(admin.id, client, new Date(), true);
  assert.deepEqual(deleted, ['cus_clean']);
  assert.deepEqual(result.skipped.map((entry) => entry.id).sort(), ['cus_charged', 'cus_invoice', 'cus_live_late']);
  assert.match(result.csv, /cus_clean.*deleted/);
  const audit = await sql`select entity_id as "entityId" from idoc.audit_log where action = 'reconciliation.unlinked_customer_deleted'`;
  assert.deepEqual(audit.map((row) => row.entityId), ['cus_clean']);
  const remaining = await sql`select external_customer_id as id from idoc.reconciliation_findings where kind = 'unlinked_customer' order by 1`;
  assert.deepEqual(remaining.map((row) => row.id), ['cus_charged', 'cus_invoice', 'cus_live_late']);
});

test('cleanup skips a customer that became linked after the batch started', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await seedUnlinked('cus_first', 'cus_late_link');
  const { client, deleted } = cleanupClient({
    onRetrieve: async (id) => {
      if (id === 'cus_first') await sql`insert into idoc.billing_accounts(profile_id, external_customer_id) values (${profile.id}, 'cus_late_link')`;
    },
  });
  await deleteUnlinkedCustomers(admin.id, client, new Date(), true);
  assert.deepEqual(deleted, ['cus_first']);
});

test('cleanup refuses to run without the production gate', async () => {
  const admin = await adminUser();
  await seedUnlinked('cus_clean');
  const { client, deleted } = cleanupClient();
  await assert.rejects(deleteUnlinkedCustomers(admin.id, client), /only available in the production deployment/);
  assert.deepEqual(deleted, []);
});

test('cleanup of selected customers acts only on those that are current findings', async () => {
  const admin = await adminUser();
  await seedUnlinked('cus_a', 'cus_b');
  const { client, deleted } = cleanupClient();
  await deleteUnlinkedCustomers(admin.id, client, new Date(), true, ['cus_a', 'cus_not_a_finding']);
  assert.deepEqual(deleted, ['cus_a']);
  const remaining = await sql`select external_customer_id as id from idoc.reconciliation_findings where kind = 'unlinked_customer'`;
  assert.deepEqual(remaining.map((row) => row.id), ['cus_b']);
});

// --- Automatic fixes run before findings are recorded --------------------------------------------------------------------------

async function seedSubscription(profileId: number, id: string, status: string) {
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values (${profileId}, ${id}, 'price_fixture', ${status}, current_date + 30, false)`;
}

test('a subscription whose saved status differs from Stripe is updated to match Stripe before findings are recorded', async () => {
  const member = await createUser();
  const profile = await createProfile(member.id);
  await seedSubscription(profile.id, 'sub_stale', 'active');
  const result = await runReconciliationScan(fakeStripeClient({ subscriptions: [{ customer: 'cus_x', id: 'sub_stale', status: 'canceled' }] }));
  assert.equal(result.findingsCount, 0, 'the fixed conflict must not be reported');
  const [row] = await sql`select status from idoc.subscriptions where external_subscription_id = 'sub_stale'`;
  assert.equal(row.status, 'canceled');
  const [preference] = await sql`select current_mode as "currentMode" from idoc.renewal_preferences where profile_id = ${profile.id}`;
  assert.equal(preference.currentMode, 'non_recurring');
  assert.equal((await sql`select 1 from idoc.audit_log where action = 'reconciliation.auto_subscription_status_synced' and entity_id = 'sub_stale'`).length, 1);
  assert.equal((await sql`select 1 from idoc.audit_log where action = 'reconciliation.auto_fix_summary'`).length, 1);
});

test('a status the local table cannot hold is reported, not forced', async () => {
  const member = await createUser();
  const profile = await createProfile(member.id);
  await seedSubscription(profile.id, 'sub_paused', 'active');
  const result = await runReconciliationScan(fakeStripeClient({ subscriptions: [{ customer: 'cus_x', id: 'sub_paused', status: 'paused' }] }));
  assert.equal(result.findingsCount, 1);
  const [row] = await sql`select status from idoc.subscriptions where external_subscription_id = 'sub_paused'`;
  assert.equal(row.status, 'active');
});

test('a renewal change whose Stripe schedule has finished is marked complete; one with a cancelled schedule is reported', async () => {
  const done = await createProfile((await createUser()).id);
  const cancelled = await createProfile((await createUser()).id);
  await seedSubscription(done.id, 'sub_done', 'active');
  await seedSubscription(cancelled.id, 'sub_cancelled_schedule', 'active');
  for (const [profile, schedule] of [[done, 'sub_sched_done'], [cancelled, 'sub_sched_cancelled']] as const) {
    await sql`insert into idoc.renewal_preferences(profile_id, current_mode, pending_mode, effective_on, expected_charge_cents, transition_state, external_subscription_schedule_id)
      values (${profile.id}, 'non_recurring', 'recurring', current_date + 10, 8000, 'pending_activation', ${schedule})`;
  }
  const client = fakeStripeClient({ subscriptions: [{ customer: 'cus_x', id: 'sub_done', status: 'active' }, { customer: 'cus_y', id: 'sub_cancelled_schedule', status: 'active' }] });
  client.subscriptionSchedules = { list: async () => ({ data: [{ id: 'sub_sched_done', status: 'completed' }, { id: 'sub_sched_cancelled', status: 'canceled' }], has_more: false }) };
  const result = await runReconciliationScan(client);
  assert.equal(result.findingsCount, 1);
  const [doneRow] = await sql`select current_mode as mode, transition_state as state from idoc.renewal_preferences where profile_id = ${done.id}`;
  assert.deepEqual(doneRow, { mode: 'recurring', state: 'current' });
  const [cancelledRow] = await sql`select transition_state as state from idoc.renewal_preferences where profile_id = ${cancelled.id}`;
  assert.equal(cancelledRow.state, 'pending_activation');
  const findings = await sql`select kind from idoc.reconciliation_findings`;
  assert.deepEqual(findings.map((row) => row.kind), ['pending_schedule_conflict']);
});

test('findings raised by Stripe notifications survive a scan; the scan replaces only its own', async () => {
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.reconciliation_findings(kind, profile_id, summary, details) values
    ('status_conflict', ${profile.id}, 'Stripe reported a successful renewal payment for a membership that is currently suspended or canceled', '{"invoiceId":"in_1"}'),
    ('status_conflict', ${profile.id}, 'scan-raised and stale', '{"kind":"status_conflict","externalSubscriptionId":"sub_gone"}')`;
  await runReconciliationScan(fakeStripeClient({}));
  const left = await sql`select summary from idoc.reconciliation_findings`;
  assert.equal(left.length, 1);
  assert.match(left[0].summary, /successful renewal payment/);
});

test('only notification-raised notices can be marked handled, and each closure is audited', async () => {
  const admin = await adminUser();
  const rows = await sql`insert into idoc.reconciliation_findings(kind, summary, details) values
    ('refund_conflict', 'refund notice', '{"refundId":"re_1"}'),
    ('status_conflict', 'notification status', '{"invoiceId":"in_1"}'),
    ('status_conflict', 'scan status', '{"kind":"status_conflict"}'),
    ('unlinked_customer', 'unlinked', '{"kind":"unlinked_customer"}') returning id`;
  const closed = await markFindingsHandled(admin.id, rows.map((row) => row.id));
  assert.equal(closed, 2);
  const left = await sql`select summary from idoc.reconciliation_findings order by id`;
  assert.deepEqual(left.map((row) => row.summary), ['scan status', 'unlinked']);
  assert.equal((await sql`select 1 from idoc.audit_log where action = 'reconciliation.finding_marked_handled'`).length, 2);
});

test('a status sync for a subscription set to cancel at period end also records the pending cancellation, as the notification would', async () => {
  const profile = await createProfile((await createUser()).id);
  await seedSubscription(profile.id, 'sub_cancel_pending', 'active');
  const periodEnd = Math.floor(Date.now() / 1000) + 20 * 86_400;
  const result = await runReconciliationScan(fakeStripeClient({
    subscriptions: [{ cancel_at_period_end: true, customer: 'cus_x', id: 'sub_cancel_pending', items: { data: [{ current_period_end: periodEnd, price: { id: 'price_fixture' } }] }, status: 'past_due' }],
  }));
  assert.equal(result.findingsCount, 0);
  const [preference] = await sql`select current_mode as mode, pending_mode as pending, transition_state as state from idoc.renewal_preferences where profile_id = ${profile.id}`;
  assert.deepEqual(preference, { mode: 'recurring', pending: 'non_recurring', state: 'cancel_pending' });
});
