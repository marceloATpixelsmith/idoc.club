import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { getLastReconciliationRun, listReconciliationFindings } from '../lib/membership/data-access.ts';
import { ignoreFindings, restoreIgnoredIssue } from '../lib/payments/reconciliation-remediation.ts';
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
  customers?: Array<{ created?: number; id: string }>;
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

async function lastSummary() {
  const [row] = await sql`select after_json as summary from idoc.audit_log where action = 'reconciliation.scan_resolution_summary' order by id desc limit 1`;
  return row?.summary as { actions: Array<{ id: string; kind: string; outcome: string }>; paused: Array<{ kind: string; reason: string }>; stripeMode: string };
}

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

test('a day-old orphaned subscription is cancelled in apply mode, audit-logged, and leaves the findings', async () => {
  const { cancelled, client } = remediationClient();
  const result = await runReconciliationScan(
    fakeStripeClient({ subscriptions: [{ created: hoursBefore(72), customer: 'cus_x', id: 'sub_orphan', status: 'active' }] }),
    { now: NOW, remediationClient: client },
  );
  assert.deepEqual(cancelled, ['sub_orphan']);
  assert.equal(result.findingsCount, 0);
  const audit = await sql`select entity_id as "entityId" from idoc.audit_log where action = 'reconciliation.orphan_subscription_canceled'`;
  assert.deepEqual(audit.map((row) => row.entityId), ['sub_orphan']);
  const summary = await lastSummary();
  assert.equal(summary.stripeMode, 'apply');
  assert.deepEqual(summary.actions.map((action) => [action.kind, action.outcome]), [['orphan_subscription_canceled', 'applied']]);
});

test('in simulate mode the same orphan leaves the findings and is logged as simulated, with nothing changed in Stripe', async () => {
  const { cancelled, client } = remediationClient();
  const result = await runReconciliationScan(
    fakeStripeClient({ subscriptions: [{ created: hoursBefore(72), customer: 'cus_x', id: 'sub_orphan', status: 'active' }] }),
    { now: NOW, remediationClient: client, stripeMode: 'simulate' },
  );
  assert.deepEqual(cancelled, []);
  assert.equal(result.findingsCount, 0, 'the report looks as if it were done');
  assert.equal((await sql`select 1 from idoc.audit_log where action = 'reconciliation.orphan_subscription_canceled'`).length, 0);
  const summary = await lastSummary();
  assert.equal(summary.stripeMode, 'simulate');
  assert.deepEqual(summary.actions.map((action) => [action.kind, action.outcome]), [['orphan_subscription_canceled', 'simulated']]);
});

test('an orphan younger than a day is reported and left alone', async () => {
  const { cancelled, client } = remediationClient();
  const result = await runReconciliationScan(
    fakeStripeClient({ subscriptions: [{ created: hoursBefore(3), customer: 'cus_x', id: 'sub_new', status: 'active' }] }),
    { now: NOW, remediationClient: client },
  );
  assert.deepEqual(cancelled, []);
  assert.equal(result.findingsCount, 1);
});

test('an orphan whose local record exists at the moment of action is never cancelled', async () => {
  const profile = await createProfile((await createUser()).id);
  const { cancelled, client } = remediationClient();
  const racing = {
    ...client,
    subscriptions: { ...client.subscriptions, retrieve: async (id: string) => {
      // The notification that creates the local row lands between the scan's read and the action.
      await seedSubscription(profile.id, id, 'active');
      return { id, status: 'active' };
    } },
  };
  await runReconciliationScan(
    fakeStripeClient({ subscriptions: [{ created: hoursBefore(72), customer: 'cus_x', id: 'sub_late', status: 'active' }] }),
    { now: NOW, remediationClient: racing },
  );
  assert.deepEqual(cancelled, []);
});

test('orphans that are a large share of everything compared are paused as a wrong-database signal; a populated database proceeds', async () => {
  const ids = Array.from({ length: 6 }, (_, index) => `sub_many_${index}`);
  const stripeSubscriptions = ids.map((id) => ({ created: hoursBefore(72), customer: 'cus_x', id, status: 'active' }));
  const first = remediationClient();
  const result = await runReconciliationScan(fakeStripeClient({ subscriptions: stripeSubscriptions }), { now: NOW, remediationClient: first.client });
  assert.deepEqual(first.cancelled, []);
  assert.equal(result.findingsCount, 6);
  assert.equal((await lastSummary()).paused[0]?.kind, 'orphan_subscription_canceled');

  for (let index = 0; index < 60; index += 1) await seedSubscription((await createProfile((await createUser()).id)).id, `sub_local_${index}`, 'active');
  const localOnStripe = Array.from({ length: 60 }, (_, index) => ({ created: hoursBefore(900), customer: 'cus_l', id: `sub_local_${index}`, status: 'active' }));
  const second = remediationClient();
  const result2 = await runReconciliationScan(fakeStripeClient({ subscriptions: [...stripeSubscriptions, ...localOnStripe] }), { now: NOW, remediationClient: second.client });
  assert.deepEqual(second.cancelled.sort(), [...ids].sort());
  assert.equal(result2.findingsCount, 0);
});

test('without any override outside production the Stripe action is simulated, never applied', async () => {
  const result = await runReconciliationScan(
    fakeStripeClient({ subscriptions: [{ created: hoursBefore(72), customer: 'cus_x', id: 'sub_orphan', status: 'active' }] }),
  );
  assert.equal(result.findingsCount, 1, 'no client able to verify it: left for a person');
  assert.equal((await lastSummary()).stripeMode, 'simulate');
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
  assert.equal((await sql`select 1 from idoc.audit_log where action = 'reconciliation.scan_resolution_summary'`).length, 1);
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

test('a finished schedule marks the renewal change complete, a cancelled one drops it, and an unrecognised status is reported', async () => {
  const done = await createProfile((await createUser()).id);
  const cancelled = await createProfile((await createUser()).id);
  const odd = await createProfile((await createUser()).id);
  for (const [profile, sub] of [[done, 'sub_done'], [cancelled, 'sub_cancelled_schedule'], [odd, 'sub_odd']] as const) await seedSubscription(profile.id, sub, 'active');
  for (const [profile, schedule] of [[done, 'sub_sched_done'], [cancelled, 'sub_sched_cancelled'], [odd, 'sub_sched_odd']] as const) {
    await sql`insert into idoc.renewal_preferences(profile_id, current_mode, pending_mode, effective_on, expected_charge_cents, transition_state, external_subscription_schedule_id)
      values (${profile.id}, 'non_recurring', 'recurring', current_date + 10, 8000, 'pending_activation', ${schedule})`;
  }
  const client = fakeStripeClient({ subscriptions: [{ customer: 'cus_x', id: 'sub_done', status: 'active' }, { customer: 'cus_y', id: 'sub_cancelled_schedule', status: 'active' }, { customer: 'cus_z', id: 'sub_odd', status: 'active' }] });
  client.subscriptionSchedules = { list: async () => ({ data: [{ id: 'sub_sched_done', status: 'completed' }, { id: 'sub_sched_cancelled', status: 'canceled' }, { id: 'sub_sched_odd', status: 'weird' }], has_more: false }) };
  const result = await runReconciliationScan(client);
  assert.equal(result.findingsCount, 1);
  const [doneRow] = await sql`select current_mode as mode, transition_state as state from idoc.renewal_preferences where profile_id = ${done.id}`;
  assert.deepEqual(doneRow, { mode: 'recurring', state: 'current' });
  const [cancelledRow] = await sql`select current_mode as mode, pending_mode as pending, transition_state as state from idoc.renewal_preferences where profile_id = ${cancelled.id}`;
  assert.deepEqual(cancelledRow, { mode: 'non_recurring', pending: null, state: 'current' });
  const [oddRow] = await sql`select transition_state as state from idoc.renewal_preferences where profile_id = ${odd.id}`;
  assert.equal(oddRow.state, 'pending_activation');
  assert.deepEqual((await sql`select kind from idoc.reconciliation_findings`).map((row) => row.kind), ['pending_schedule_conflict']);
});

test('a subscription IDOC treats as open that Stripe does not have is marked cancelled; a wrong-account share is paused', async () => {
  const profile = await createProfile((await createUser()).id);
  await seedSubscription(profile.id, 'sub_gone', 'active');
  const closed = await createProfile((await createUser()).id);
  await seedSubscription(closed.id, 'sub_long_ended', 'canceled');
  for (let index = 0; index < 30; index += 1) await seedSubscription((await createProfile((await createUser()).id)).id, `sub_present_${index}`, 'active');
  const present = Array.from({ length: 30 }, (_, index) => ({ customer: 'cus_p', id: `sub_present_${index}`, status: 'active' }));
  const result = await runReconciliationScan(fakeStripeClient({ subscriptions: present }));
  assert.equal(result.findingsCount, 0);
  assert.equal((await sql`select status from idoc.subscriptions where external_subscription_id = 'sub_gone'`)[0].status, 'canceled');
  assert.equal((await sql`select current_mode as mode from idoc.renewal_preferences where profile_id = ${profile.id}`)[0].mode, 'non_recurring');
  assert.equal((await sql`select 1 from idoc.audit_log where action = 'reconciliation.auto_subscription_marked_canceled'`).length, 1);

  // Now Stripe appears to have almost none of them (the wrong account): nothing is marked cancelled.
  await sql`update idoc.subscriptions set status = 'active' where external_subscription_id like 'sub_present_%'`;
  const second = await runReconciliationScan(fakeStripeClient({ subscriptions: [] }));
  assert.equal(second.findingsCount, 30);
  assert.equal((await sql`select count(*)::int as n from idoc.subscriptions where status = 'active'`)[0].n, 30);
  assert.equal((await lastSummary()).paused[0]?.kind, 'subscription_marked_canceled');
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

test('every scan records a resolution summary, even when nothing was resolved', async () => {
  await runReconciliationScan(fakeStripeClient({}));
  const summary = await lastSummary();
  assert.deepEqual(summary.actions, []);
});

function customerClient(options: { charged?: string[]; liveSubs?: Record<string, string> } = {}) {
  const deleted: string[] = [];
  const client = {
    charges: { list: async (params: { customer: string }) => ({ data: options.charged?.includes(params.customer) ? [{ id: 'ch_1' }] : [] }) },
    customers: { del: async (id: string) => { deleted.push(id); return {}; } },
    invoices: { list: async () => ({ data: [] }) },
    subscriptions: {
      cancel: async () => ({}),
      list: async (params: { customer?: string }) => ({ data: options.liveSubs?.[params.customer ?? ''] ? [{ id: 's1', status: options.liveSubs[params.customer ?? ''] }] : [], has_more: false }),
      retrieve: async (id: string) => ({ id, status: 'active' }),
    },
  };
  return { client, deleted };
}

async function populatedAccounts(count: number) {
  for (let index = 0; index < count; index += 1) {
    const profile = await createProfile((await createUser()).id);
    await sql`insert into idoc.billing_accounts(profile_id, external_customer_id) values (${profile.id}, ${`cus_known_${index}`})`;
  }
  return Array.from({ length: count }, (_, index) => ({ created: hoursBefore(2000), id: `cus_known_${index}` }));
}

test('unlinked customers are deleted automatically when old, unlinked and inactive; others stay for a person', async () => {
  const known = await populatedAccounts(30);
  const { client, deleted } = customerClient({ charged: ['cus_recent_charge'], liveSubs: { cus_live_sub: 'active' } });
  const customers = [...known, { created: hoursBefore(300), id: 'cus_clean' }, { created: hoursBefore(300), id: 'cus_recent_charge' }, { created: hoursBefore(300), id: 'cus_live_sub' }, { created: hoursBefore(2), id: 'cus_new' }];
  const stripe = fakeStripeClient({ customers });
  const result = await runReconciliationScan(stripe, { now: NOW, remediationClient: client });
  assert.deepEqual(deleted, ['cus_clean']);
  assert.equal(result.findingsCount, 3);
  assert.equal((await sql`select 1 from idoc.audit_log where action = 'reconciliation.unlinked_customer_deleted' and entity_id = 'cus_clean'`).length, 1);
});

test('in simulate mode the unlinked customer is removed from the report but never deleted', async () => {
  const known = await populatedAccounts(30);
  const { client, deleted } = customerClient();
  const result = await runReconciliationScan(fakeStripeClient({ customers: [...known, { created: hoursBefore(300), id: 'cus_clean' }] }), { now: NOW, remediationClient: client, stripeMode: 'simulate' });
  assert.deepEqual(deleted, []);
  assert.equal(result.findingsCount, 0);
  assert.deepEqual((await lastSummary()).actions.map((action) => [action.kind, action.outcome]), [['unlinked_customer_deleted', 'simulated']]);
});

test('unlinked customers that dwarf the local database are paused as a wrong-database signal', async () => {
  const { client, deleted } = customerClient();
  const customers = Array.from({ length: 8 }, (_, index) => ({ created: hoursBefore(300), id: `cus_unlinked_${index}` }));
  const result = await runReconciliationScan(fakeStripeClient({ customers }), { now: NOW, remediationClient: client });
  assert.deepEqual(deleted, []);
  assert.equal(result.findingsCount, 8);
  assert.equal((await lastSummary()).paused[0]?.kind, 'unlinked_customer_deleted');
});

// --- Ignoring specific issues --------------------------------------------------------------------------------------------------

async function failingSubscriptionScan(profileSubscription = 'sub_failing') {
  return runReconciliationScan(fakeStripeClient({
    invoices: [invoiceFixture('in_1', 3, profileSubscription)],
    subscriptions: [{ customer: 'cus_x', id: profileSubscription, status: 'past_due' }],
  }));
}

async function seedFailingMember() {
  const profile = await createProfile((await createUser()).id);
  await seedSubscription(profile.id, 'sub_failing', 'past_due');
}

test('an ignored repeated-failure issue stays out of the report on later scans, is remembered, and is dropped once the failures clear', async () => {
  const admin = await adminUser();
  await seedFailingMember();
  assert.equal((await failingSubscriptionScan()).findingsCount, 1);
  const [finding] = await sql`select id from idoc.reconciliation_findings where kind = 'repeated_failure'`;
  assert.equal(await ignoreFindings(admin.id, [finding.id]), 1);
  assert.equal((await sql`select 1 from idoc.reconciliation_findings`).length, 0);
  assert.equal((await sql`select 1 from idoc.audit_log where action = 'reconciliation.finding_ignored'`).length, 1);

  assert.equal((await failingSubscriptionScan()).findingsCount, 0, 'still failing, but ignored');
  assert.equal((await sql`select 1 from idoc.reconciliation_ignores`).length, 1);

  await runReconciliationScan(fakeStripeClient({ subscriptions: [{ customer: 'cus_x', id: 'sub_failing', status: 'past_due' }] }));
  assert.equal((await sql`select 1 from idoc.reconciliation_ignores`).length, 0, 'the issue cleared, so the ignore is forgotten');
  assert.equal((await failingSubscriptionScan()).findingsCount, 1, 'a later recurrence is reported afresh');
});

test('restoring an ignored issue brings it back on the next scan', async () => {
  const admin = await adminUser();
  await seedFailingMember();
  await failingSubscriptionScan();
  const [finding] = await sql`select id from idoc.reconciliation_findings`;
  await ignoreFindings(admin.id, [finding.id]);
  const [ignored] = await sql`select id from idoc.reconciliation_ignores`;
  assert.equal(await restoreIgnoredIssue(admin.id, ignored.id), true);
  assert.equal((await failingSubscriptionScan()).findingsCount, 1);
});

test('an ignored unlinked customer is also left out of the scan\'s automatic deletion', async () => {
  const admin = await adminUser();
  for (let index = 0; index < 30; index += 1) {
    const profile = await createProfile((await createUser()).id);
    await sql`insert into idoc.billing_accounts(profile_id, external_customer_id) values (${profile.id}, ${`cus_known_${index}`})`;
  }
  const known = Array.from({ length: 30 }, (_, index) => ({ created: hoursBefore(2000), id: `cus_known_${index}` }));
  const stripeCustomers = [...known, { created: hoursBefore(300), id: 'cus_keep' }];
  const unlinkedClient = (deleted: string[]) => ({
    charges: { list: async () => ({ data: [] }) }, customers: { del: async (id: string) => { deleted.push(id); return {}; } }, invoices: { list: async () => ({ data: [] }) },
    subscriptions: { cancel: async () => ({}), list: async () => ({ data: [], has_more: false }), retrieve: async (id: string) => ({ id, status: 'active' }) },
  });
  const first: string[] = [];
  await runReconciliationScan(fakeStripeClient({ customers: stripeCustomers }), { now: NOW, remediationClient: unlinkedClient(first), stripeMode: 'simulate' });
  // Simulated: it left the findings, so ignore it by seeding the finding the way an unverifiable one would be recorded.
  await sql`insert into idoc.reconciliation_findings(kind, external_customer_id, summary, details) values ('unlinked_customer', 'cus_keep', 'Stripe Customer cus_keep has no matching local billing account.', '{"kind":"unlinked_customer","externalCustomerId":"cus_keep"}')`;
  const [finding] = await sql`select id from idoc.reconciliation_findings where external_customer_id = 'cus_keep'`;
  await ignoreFindings(admin.id, [finding.id]);
  const deleted: string[] = [];
  const result = await runReconciliationScan(fakeStripeClient({ customers: stripeCustomers }), { now: NOW, remediationClient: unlinkedClient(deleted) });
  assert.deepEqual(deleted, [], 'an ignored customer is never deleted automatically');
  assert.equal(result.findingsCount, 0);
});

test('ignore closes notification-raised notices, refuses what it cannot ignore, and audits every change', async () => {
  const admin = await adminUser();
  const rows = await sql`insert into idoc.reconciliation_findings(kind, summary, details) values
    ('refund_conflict', 'refund notice', '{"refundId":"re_1"}'),
    ('status_conflict', 'notification status', '{"invoiceId":"in_1"}'),
    ('seminar_payment_conflict', 'scan seminar without an id', '{"source":"daily_seminar_scan"}'),
    ('status_conflict', 'scan status without any id', '{"kind":"status_conflict"}') returning id`;
  assert.equal(await ignoreFindings(admin.id, rows.map((row) => row.id)), 2);
  assert.deepEqual((await sql`select summary from idoc.reconciliation_findings order by id`).map((row) => row.summary), ['scan seminar without an id', 'scan status without any id']);
  assert.equal((await sql`select 1 from idoc.audit_log where action = 'reconciliation.finding_closed'`).length, 2);
  assert.equal((await sql`select 1 from idoc.reconciliation_ignores`).length, 0);
});
