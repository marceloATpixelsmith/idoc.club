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
