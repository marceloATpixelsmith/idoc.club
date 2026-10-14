import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { getRevenueReport } from '../lib/payments/revenue-report.ts';
import { adminUser, asAdmin, closeHarness, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('monthly revenue query loads recorded payments with its month field', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.payments(profile_id, source, amount_cents, currency, paid_at, administrator_id, reason)
    values (${profile.id}, 'cash', 8000, 'EUR', '2026-09-15T12:00:00Z', ${admin.id}, 'Recorded payment')`;

  const report = await asAdmin(admin.id, () => getRevenueReport({ from: '2026-09-01', to: '2026-09-30' }));
  assert.deepEqual(report.overTime, [{ currency: 'EUR', month: '2026-09', totalCents: 8000 }]);
  assert.equal(report.summary[0]?.totalCents, 8000);
});

async function recordPayment(profileId: number, adminId: number, source: string, paidAt: string, extra: { externalPaymentId?: string } = {}) {
  await sql`insert into idoc.payments(profile_id, source, amount_cents, currency, paid_at, administrator_id, external_payment_id, reason)
    values (${profileId}, ${source}, 8000, 'EUR', ${paidAt}, ${source.startsWith('stripe_') && source !== 'stripe_manual' ? null : adminId}, ${extra.externalPaymentId ?? null}, 'fixture')`;
}

test('the default view is all time, not a rolling window', async () => {
  const admin = await adminUser();
  const profile = await createProfile((await createUser()).id);
  await recordPayment(profile.id, admin.id, 'cash', '2019-03-10T12:00:00Z');
  await recordPayment(profile.id, admin.id, 'cash', '2026-09-15T12:00:00Z');
  const report = await asAdmin(admin.id, () => getRevenueReport({}));
  assert.deepEqual(report.range, { from: null, to: null });
  assert.equal(report.summary[0]?.paymentCount, 2);
  const lone = await asAdmin(admin.id, () => getRevenueReport({ from: '2026-01-01' }));
  assert.equal(lone.summary[0]?.paymentCount, 1, 'a lone start date runs through today');
});

test('the Payment source filter offers All, Stripe (including administrator-registered Stripe), Bank Transfer and Cash', async () => {
  const admin = await adminUser();
  const profile = await createProfile((await createUser()).id);
  await recordPayment(profile.id, admin.id, 'stripe_one_time', '2026-09-01T12:00:00Z', { externalPaymentId: 'pi_report_1' });
  await recordPayment(profile.id, admin.id, 'stripe_manual', '2026-09-02T12:00:00Z');
  await recordPayment(profile.id, admin.id, 'bank_transfer', '2026-09-03T12:00:00Z');
  await recordPayment(profile.id, admin.id, 'cash', '2026-09-04T12:00:00Z');
  const count = async (source?: string) => (await asAdmin(admin.id, () => getRevenueReport({ source })))?.summary[0]?.paymentCount;
  assert.equal(await count(), 4);
  assert.equal(await count('stripe'), 2);
  assert.equal(await count('bank_transfer'), 1);
  assert.equal(await count('cash'), 1);
  const stripe = await asAdmin(admin.id, () => getRevenueReport({ source: 'stripe' }));
  assert.equal(stripe.summary[0]?.stripeCents, 16000);
  assert.equal(stripe.summary[0]?.manualCents, 0);
});
