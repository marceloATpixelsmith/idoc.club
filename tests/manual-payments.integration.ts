import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { recordManualPayment } from '../lib/payments/manual-payments.ts';
import { searchMembersForAdmin } from '../lib/membership/data-access.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import {
  adminUser, asAdmin, closeHarness, createMembership, createProfile, createUser, resetIdoc, sql,
} from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('a manually registered Stripe payment is recorded with the reference, extends the membership, and writes a full audit trail', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true); // valid_until 2099-12-31

  const result = await asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: 'Phone request, confirmed by email', reference: 'pi_manual_12345', source: 'stripe_manual',
  }));
  assert.equal(result.payment.source, 'stripe_manual');
  assert.equal(result.payment.amountCents, 8000);
  assert.equal(result.payment.currency, 'EUR');
  assert.equal(result.payment.administratorId, admin.id);
  assert.equal(result.payment.reference, 'pi_manual_12345');
  assert.equal(result.membership.status, 'active');
  assert.equal(result.membership.validUntil, '2100-12-31'); // early renewal: 2099-12-31 + 1 year

  const [auditRow] = await sql`select action, actor_id, reason, entity_type, entity_id from idoc.audit_log where action='admin.payment.recorded'`;
  assert.equal(auditRow.actor_id, admin.id);
  assert.equal(auditRow.reason, 'Phone request, confirmed by email');
  assert.equal(auditRow.entity_type, 'profile');
  assert.equal(auditRow.entity_id, String(profile.id));
});

test('a bank_transfer payment requires a reference and records the manual source', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: 'Wire confirmed', reference: 'WIRE-998', source: 'bank_transfer',
  }));
  const [row] = await sql`select source, reference from idoc.payments where profile_id=${profile.id}`;
  assert.equal(row.source, 'bank_transfer');
  assert.equal(row.reference, 'WIRE-998');
});

test('a cash payment requires a receipt ID and stores it', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await assert.rejects(asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: 'Paid at front desk', source: 'cash',
  })));
  assert.equal((await sql`select count(*)::int as count from idoc.payments where profile_id=${profile.id}`)[0].count, 0);
  const result = await asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: 'Paid at front desk', reference: 'RCPT-4471', source: 'cash',
  }));
  assert.equal(result.payment.source, 'cash');
  assert.equal(result.payment.reference, 'RCPT-4471');
  assert.equal(result.membership.status, 'active');
});

test('a complimentary grant records the nominal €80 value, requires no reference, and sets status complimentary', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  const result = await asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: 'Board-approved complimentary membership', source: 'complimentary',
  }));
  assert.equal(result.payment.source, 'complimentary');
  assert.equal(result.payment.amountCents, 8000);
  assert.equal(result.membership.status, 'complimentary');
});

test('stripe_manual and bank_transfer without a Stripe Payment ID / bank transfer reference are rejected before any row is written (cash is covered by its own test)', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  for (const source of ['stripe_manual', 'bank_transfer'] as const) {
    await assert.rejects(asAdmin(admin.id, () => recordManualPayment({
      paidAt: '2026-01-01', profileId: profile.id, reason: 'Missing reference', source,
    })));
  }
  assert.equal((await sql`select count(*)::int as count from idoc.payments where profile_id=${profile.id}`)[0].count, 0);
});

test('a missing reason is rejected and writes no rows', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await assert.rejects(asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: '', reference: 'RCPT-1', source: 'cash',
  })));
  assert.equal((await sql`select count(*)::int as count from idoc.payments where profile_id=${profile.id}`)[0].count, 0);
  assert.equal((await sql`select count(*)::int as count from idoc.audit_log where entity_id=${String(profile.id)}`)[0].count, 0);
});

test('a future paid date is rejected, since it cannot be an actual payment date yet', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  await assert.rejects(asAdmin(admin.id, () => recordManualPayment({
    paidAt: tomorrow, profileId: profile.id, reason: 'Backdated incorrectly', reference: 'RCPT-1', source: 'cash',
  })));
  assert.equal((await sql`select count(*)::int as count from idoc.payments where profile_id=${profile.id}`)[0].count, 0);
});

test('an impossible calendar date is rejected rather than silently normalized', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await assert.rejects(asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-02-30', profileId: profile.id, reason: 'Not a real date', reference: 'RCPT-1', source: 'cash',
  })));
  assert.equal((await sql`select count(*)::int as count from idoc.payments where profile_id=${profile.id}`)[0].count, 0);
});

test('concurrent manual payments for the same profile do not lose an extension to a lost update', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true); // valid_until 2099-12-31
  await Promise.all([
    asAdmin(admin.id, () => recordManualPayment({ paidAt: '2026-01-01', profileId: profile.id, reason: 'Concurrent payment 1', reference: 'RCPT-1', source: 'cash' })),
    asAdmin(admin.id, () => recordManualPayment({ paidAt: '2026-01-01', profileId: profile.id, reason: 'Concurrent payment 2', reference: 'RCPT-1', source: 'cash' })),
  ]);
  assert.equal((await sql`select count(*)::int as count from idoc.payments where profile_id=${profile.id}`)[0].count, 2, 'both payments must still be recorded');
  const [after] = await sql`select valid_until from idoc.memberships where profile_id=${profile.id}`;
  // Without a row lock, both transactions would read the same starting validUntil and derive the
  // same one-year extension, losing one of the two renewals (final value 2100-12-31 instead of
  // the correct cumulative 2101-12-31).
  assert.equal(after.valid_until, '2101-12-31');
});

test('a non-administrator cannot record a manual payment', async () => {
  const nonAdmin = await createUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await assert.rejects(withTestMembershipBoundary({ actor: { id: nonAdmin.id, roles: [] } }, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: 'Should not be permitted', reference: 'RCPT-1', source: 'cash',
  })));
  assert.equal((await sql`select count(*)::int as count from idoc.payments where profile_id=${profile.id}`)[0].count, 0);
});

test('an early renewal, paid before the current paid-through date, adds 12 months to that date', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true); // valid_until 2099-12-31
  const result = await asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-06-01', profileId: profile.id, reason: 'Early renewal', reference: 'RCPT-1', source: 'cash',
  }));
  assert.equal(result.membership.validUntil, '2100-12-31');
});

test('a renewal paid after expiration starts a fresh 12-month term from the actual payment date', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, false); // valid_until 2025-12-31, status expired
  const result = await asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-06-01', profileId: profile.id, reason: 'Late renewal', reference: 'RCPT-1', source: 'cash',
  }));
  assert.equal(result.membership.validUntil, '2027-06-01');
  assert.equal(result.membership.status, 'active');
});

test('a profile with no prior membership gets a new membership row sourced as manual', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  const result = await asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: 'First payment', reference: 'RCPT-1', source: 'cash',
  }));
  assert.equal(result.membership.source, 'manual');
  assert.equal(result.membership.startsOn, '2026-01-01');
  assert.equal(result.membership.validUntil, '2027-01-01');
});

test('a suspended membership stays suspended after a manual payment, even though its paid-through date extends', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'suspended','2025-01-01','2099-12-31','migration')`;
  const result = await asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: 'Payment while suspended', reference: 'RCPT-1', source: 'cash',
  }));
  assert.equal(result.membership.status, 'suspended');
  assert.equal(result.membership.validUntil, '2100-12-31');
});

test('a canceled membership stays canceled after a manual payment until an administrator reverses the cancellation', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'canceled','2025-01-01','2099-12-31','migration')`;
  const result = await asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: 'Late payment after cancellation', reference: 'RCPT-1', source: 'cash',
  }));
  assert.equal(result.membership.status, 'canceled');
});

test('searchMembersForAdmin matches case-insensitively on name or email, requires 2+ characters, and is administrator-only', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id); // profileInput() default: firstName 'Test', lastName 'Member'

  const byEmail = await asAdmin(admin.id, () => searchMembersForAdmin(member.email.toUpperCase()));
  assert.equal(byEmail.length, 1);
  assert.equal(byEmail[0].profileId, profile.id);
  assert.equal(byEmail[0].email, member.email);

  const byLastName = await asAdmin(admin.id, () => searchMembersForAdmin('MEMBER'));
  assert.equal(byLastName.length, 1);
  assert.equal(byLastName[0].profileId, profile.id);

  assert.deepEqual(await asAdmin(admin.id, () => searchMembersForAdmin('a')), []);

  const nonAdmin = await createUser();
  await assert.rejects(withTestMembershipBoundary({ actor: { id: nonAdmin.id, roles: [] } }, () => searchMembersForAdmin(member.email)));
});

test('PayPal is no longer an accepted manual payment source', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await assert.rejects(asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: 'Retired source', reference: 'PP-1', source: 'paypal',
  })));
});

test('recording an active member\'s manual payment queues the "fully paid and accessible" email, once, but a complimentary grant does not', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  const result = await asAdmin(admin.id, () => recordManualPayment({
    paidAt: '2026-01-01', profileId: profile.id, reason: 'Paid by transfer', reference: 'BT-1', source: 'bank_transfer',
  }));
  const queued = await sql`select kind,payload,dedupe_key from idoc.notification_outbox where profile_id=${profile.id} and kind='membership.manual_payment_recorded'`;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].dedupe_key, `membership.manual_payment_recorded:${result.payment.id}`);
  assert.equal(queued[0].payload.to, member.email);
  assert.equal(queued[0].payload.expirationDate, result.membership.validUntil);

  const other = await createUser();
  const otherProfile = await createProfile(other.id);
  await asAdmin(admin.id, () => recordManualPayment({ paidAt: '2026-01-01', profileId: otherProfile.id, reason: 'Granted', source: 'complimentary' }));
  assert.equal((await sql`select count(*)::int count from idoc.notification_outbox where profile_id=${otherProfile.id} and kind='membership.manual_payment_recorded'`)[0].count, 0);
});
