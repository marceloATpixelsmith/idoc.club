import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { listAdminPaymentHistory } from '../lib/membership/data-access.ts';
import { extendMembershipExpiration } from '../lib/membership/status-actions.ts';
import { adminUser, asAdmin, closeHarness, createMembership, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('administrator payment history is scoped, safe, and newest first', async () => {
  const admin = await adminUser();
  const first = await createProfile((await createUser()).id);
  const second = await createProfile((await createUser()).id);
  await sql`insert into idoc.payments(profile_id,source,external_payment_id,amount_cents,currency,paid_at)
    values(${first.id},'stripe_one_time','pi_safe_old',8000,'EUR','2025-01-01')`;
  await sql`insert into idoc.payments(profile_id,source,amount_cents,currency,paid_at,administrator_id,reason,reference)
    values(${first.id},'cash',8000,'EUR','2026-01-01',${admin.id},'private reason','receipt-safe')`;
  await sql`insert into idoc.payments(profile_id,source,amount_cents,currency,paid_at,administrator_id,reason)
    values(${second.id},'cash',8000,'EUR','2027-01-01',${admin.id},'unrelated')`;

  const history = await asAdmin(admin.id, () => listAdminPaymentHistory(first.id));
  assert.equal(history.length, 2);
  assert.equal(history[0].reference, 'receipt-safe');
  assert.equal(history[1].reference, 'pi_safe_old');
  assert.deepEqual(Object.keys(history[0]).sort(), ['amountCents', 'currency', 'paidAt', 'reference', 'source'].sort());
});

test('expiration extension rejects shortening, preserves ledger and Stripe state, and retries idempotently', async () => {
  const admin = await adminUser();
  const profile = await createProfile((await createUser()).id);
  await createMembership(profile.id);
  await sql`insert into idoc.subscriptions(profile_id,external_subscription_id,price_id,status,current_period_end)
    values(${profile.id},'sub_unchanged','price_unchanged','active','2099-12-31')`;
  await assert.rejects(asAdmin(admin.id, () => extendMembershipExpiration(profile.id, {
    reason: 'Not an extension', validUntil: '2099-01-01',
  })), /cannot shorten/);
  await assert.rejects(asAdmin(admin.id, () => extendMembershipExpiration(profile.id, {
    reason: '', validUntil: '2100-12-31',
  })), /reason/i);

  const first = await asAdmin(admin.id, () => extendMembershipExpiration(profile.id, {
    reason: 'Board-approved extension', validUntil: '2100-12-31',
  }));
  const retry = await asAdmin(admin.id, () => extendMembershipExpiration(profile.id, {
    reason: 'Board-approved extension', validUntil: '2100-12-31',
  }));
  assert.equal(first.unchanged, false);
  assert.equal(retry.unchanged, true);
  const [counts] = await sql`select
    (select count(*)::int from idoc.payments where profile_id=${profile.id}) payments,
    (select count(*)::int from idoc.audit_log where entity_id=${String(profile.id)} and action='admin.membership.expiration_extended') audits`;
  assert.deepEqual(counts, { audits: 1, payments: 0 });
  const [subscription] = await sql`select external_subscription_id,status,current_period_end from idoc.subscriptions where profile_id=${profile.id}`;
  assert.deepEqual(subscription, { current_period_end: '2099-12-31', external_subscription_id: 'sub_unchanged', status: 'active' });
});
