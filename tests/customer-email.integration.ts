import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { deliverNextStripeCustomerEmailSync } from '../lib/payments/customer-email.ts';
import { closeHarness, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

async function fixture(customerId: string) {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await sql`insert into idoc.billing_accounts(profile_id,external_customer_id) values(${profile.id},${customerId})`;
  return { profile, user };
}

async function enqueue(profileId: number, payload: Record<string, unknown> = {}) {
  const [job] = await sql<{ id: number }[]>`insert into idoc.notification_outbox(profile_id,kind,payload,dedupe_key)
    values(${profileId},'stripe.customer_email_sync',${JSON.stringify(payload)}::jsonb,${`stripe-email:${profileId}`}) returning id`;
  return job.id;
}

test('Stripe customer-email worker leases once, ignores forged payload ownership, updates the authoritative Customer, and audits success', async () => {
  const owner = await fixture('cus_owner');
  const other = await fixture('cus_other');
  const jobId = await enqueue(owner.profile.id, { customerId: 'cus_other', email: other.user.email });
  const calls: unknown[][] = [];
  const stripe = { customers: { update: async (...args: unknown[]) => { calls.push(args); } } };
  const [first, concurrent] = await Promise.all([
    deliverNextStripeCustomerEmailSync('worker-a', stripe),
    deliverNextStripeCustomerEmailSync('worker-b', stripe),
  ]);
  assert.deepEqual(new Set([first.status, concurrent.status]), new Set(['sent', 'empty']));
  assert.deepEqual(calls, [['cus_owner', { email: owner.user.email }]]);
  const [job] = await sql`select sent_at,attempt_count,lease_owner,lease_expires_at from idoc.notification_outbox where id=${jobId}`;
  assert.ok(job.sent_at);
  assert.equal(job.attempt_count, 0);
  assert.equal(job.lease_owner, null);
  assert.equal(job.lease_expires_at, null);
  assert.equal((await sql`select count(*)::int count from idoc.audit_log where action='stripe.customer_email_sync.completed' and entity_id=${String(owner.profile.id)}`)[0].count, 1);
});

test('Stripe customer-email worker retries transient failure, recovers an expired lease, and dead-letters exactly at the bounded eighth attempt', async () => {
  const owner = await fixture('cus_retry');
  const jobId = await enqueue(owner.profile.id);
  const failing = { customers: { update: async () => { throw new Error('secret provider detail'); } } };
  assert.equal((await deliverNextStripeCustomerEmailSync('worker-fail', failing)).status, 'retry');
  let [job] = await sql`select attempt_count,last_error_code,dead_lettered_at from idoc.notification_outbox where id=${jobId}`;
  assert.equal(job.attempt_count, 1);
  assert.equal(job.last_error_code, 'stripe_sync_failed');
  assert.equal(job.dead_lettered_at, null);

  await sql`update idoc.notification_outbox set attempt_count=7,available_at=now()-interval '1 minute',
    lease_owner='dead-worker',lease_expires_at=now()-interval '1 minute' where id=${jobId}`;
  assert.equal((await deliverNextStripeCustomerEmailSync('recovery-worker', failing)).status, 'dead_lettered');
  [job] = await sql`select attempt_count,last_error_code,dead_lettered_at,lease_owner from idoc.notification_outbox where id=${jobId}`;
  assert.equal(job.attempt_count, 8);
  assert.ok(job.dead_lettered_at);
  assert.equal(job.lease_owner, null);
  assert.equal((await sql`select count(*)::int count from idoc.reconciliation_findings where profile_id=${owner.profile.id} and kind='unlinked_customer'`)[0].count, 1);
  assert.equal((await sql`select count(*)::int count from idoc.audit_log where action='stripe.customer_email_sync.dead_lettered' and entity_id=${String(owner.profile.id)}`)[0].count, 1);
  assert.equal((await deliverNextStripeCustomerEmailSync('late-worker', failing)).status, 'empty');
});
