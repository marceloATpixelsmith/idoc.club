import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { AuthorizationError } from '../lib/membership/authorization.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { processStripeEvent } from '../lib/payments/webhook-handlers.ts';
import { refundSeminarRegistration } from '../lib/payments/refunds.ts';
import { createSeminarCheckoutSession } from '../lib/seminars/checkout.ts';
import {
  cancelOwnRegistration, exportSeminarRegistrationsCsvRows, getSeminarPaymentMethodInstructions,
  listAdminSeminarRegistrations, listCurrentSeminarsForMember, listPastSeminarsForMember,
  markRegistrationPaymentReceived, registerForSeminar,
} from '../lib/seminars/registrations.ts';
import { createSeminar, getAdminSeminar, listAdminSeminars, SeminarValidationError, updateSeminar } from '../lib/seminars/seminars.ts';
import {
  adminUser, closeHarness, concurrently, createMembership, createProfile, createUser, resetIdoc, sql,
} from './postgres-harness.ts';

beforeEach(async () => {
  process.env.BASE_URL = 'https://idoc.club';
  await resetIdoc();
  // Bank Transfer and Cash at the Event start disabled by default (migration 0038); only Online
  // via Stripe is enabled out of the box. Most fixtures here need all three available.
  await sql`update idoc.seminar_payment_methods set enabled=true where canonical_id in ('bank_transfer','cash_event')`;
});
after(closeHarness);

function asAdmin<T>(adminId: number, operation: () => Promise<T>) {
  return withTestMembershipBoundary({ actor: { id: adminId, roles: [] } }, operation);
}
function asMember<T>(userId: number, operation: () => Promise<T>) {
  return withTestMembershipBoundary({ actor: { id: userId, roles: [] } }, operation);
}

function future(hours: number) { return new Date(Date.now() + hours * 3_600_000).toISOString(); }
function past(hours: number) { return new Date(Date.now() - hours * 3_600_000).toISOString(); }

async function paidMember() {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  return { profile, user };
}

function seminarInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    capacity: 2, description: 'A hands-on judging clinic.', endTime: '11:00', location: 'Arena 3, IDOC Headquarters',
    paymentMethodId: 'online_stripe', price: '45.00', registrationDeadline: future(48),
    seminarDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    startTime: '09:00', status: 'published', timezone: 'Europe/Berlin', title: 'Judging Clinic', ...overrides,
  };
}

async function publishedSeminar(adminId: number, overrides: Partial<Record<string, unknown>> = {}) {
  return asAdmin(adminId, () => createSeminar(seminarInput(overrides)));
}

test('an authenticated non-administrator cannot create a seminar', async () => {
  const { user } = await paidMember();
  await assert.rejects(asMember(user.id, () => createSeminar(seminarInput())), AuthorizationError);
});

test('capacity, price, and payment-method-canonical-id are constrained server-side with documented limits', async () => {
  const admin = await adminUser();
  await assert.rejects(asAdmin(admin.id, () => createSeminar(seminarInput({ capacity: 0 }))), SeminarValidationError);
  await assert.rejects(asAdmin(admin.id, () => createSeminar(seminarInput({ price: -5 }))), SeminarValidationError);
  await assert.rejects(asAdmin(admin.id, () => createSeminar(seminarInput({ paymentMethodId: 'venmo' }))), SeminarValidationError);
  await assert.rejects(asAdmin(admin.id, () => createSeminar(seminarInput({ endTime: '08:00' }))), SeminarValidationError, 'end time must be after start time');
  await assert.rejects(asAdmin(admin.id, () => createSeminar(seminarInput({ timezone: 'Not/AZone' }))), SeminarValidationError);
});

test('a seminar cannot use a payment method that is not currently enabled in Organization Settings', async () => {
  const admin = await adminUser();
  await sql`update idoc.seminar_payment_methods set enabled=false where canonical_id='bank_transfer'`;
  await assert.rejects(asAdmin(admin.id, () => createSeminar(seminarInput({ paymentMethodId: 'bank_transfer' }))), SeminarValidationError);
});

test('a member can register for an open seminar, and a second registration for the same seminar is rejected as a duplicate', async () => {
  const admin = await adminUser();
  const { profile, user } = await paidMember();
  const seminarId = await publishedSeminar(admin.id);
  const { paymentMethod } = await asMember(user.id, () => registerForSeminar(seminarId));
  assert.equal(paymentMethod, 'online_stripe');
  await assert.rejects(asMember(user.id, () => registerForSeminar(seminarId)), /already registered/);
  const [row] = await sql`select registration_status,payment_status from idoc.seminar_registrations where seminar_id=${seminarId} and profile_id=${profile.id}`;
  assert.equal(row.registration_status, 'registered');
  assert.equal(row.payment_status, 'unpaid');
});

test('bank transfer and cash seminars start registrations in their own pending payment state, never "paid"', async () => {
  const admin = await adminUser();
  const { user: bankUser } = await paidMember();
  const bankSeminarId = await publishedSeminar(admin.id, { paymentMethodId: 'bank_transfer' });
  await asMember(bankUser.id, () => registerForSeminar(bankSeminarId));
  const [bankRow] = await sql`select payment_status from idoc.seminar_registrations where seminar_id=${bankSeminarId}`;
  assert.equal(bankRow.payment_status, 'bank_transfer_pending');

  const { user: cashUser } = await paidMember();
  const cashSeminarId = await publishedSeminar(admin.id, { paymentMethodId: 'cash_event' });
  await asMember(cashUser.id, () => registerForSeminar(cashSeminarId));
  const [cashRow] = await sql`select payment_status from idoc.seminar_registrations where seminar_id=${cashSeminarId}`;
  assert.equal(cashRow.payment_status, 'cash_pending');
});

test('registration is rejected once the deadline has passed or the seminar is not published', async () => {
  const admin = await adminUser();
  const { user: lateUser } = await paidMember();
  const closedSeminarId = await publishedSeminar(admin.id, { registrationDeadline: past(1) });
  await assert.rejects(asMember(lateUser.id, () => registerForSeminar(closedSeminarId)), /closed/);

  const { user: draftUser } = await paidMember();
  const draftSeminarId = await asAdmin(admin.id, () => createSeminar(seminarInput({ status: 'draft' })));
  await assert.rejects(asMember(draftUser.id, () => registerForSeminar(draftSeminarId)), /not open/);
});

test('capacity enforcement: the seat exactly at capacity succeeds and the next registration is rejected as full', async () => {
  const admin = await adminUser();
  const seminarId = await publishedSeminar(admin.id, { capacity: 1 });
  const { user: first } = await paidMember();
  const { user: second } = await paidMember();
  await asMember(first.id, () => registerForSeminar(seminarId));
  await assert.rejects(asMember(second.id, () => registerForSeminar(seminarId)), /full/);
});

test('concurrency: two members racing for the last open seat under a row lock resolve to exactly one success', async () => {
  const admin = await adminUser();
  const seminarId = await publishedSeminar(admin.id, { capacity: 1 });
  const { user: first } = await paidMember();
  const { user: second } = await paidMember();
  const results = await concurrently(
    () => asMember(first.id, () => registerForSeminar(seminarId)),
    () => asMember(second.id, () => registerForSeminar(seminarId)),
  );
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent registration must win the last seat');
  assert.equal(rejected.length, 1);
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.seminar_registrations where seminar_id=${seminarId} and registration_status='registered'`;
  assert.equal(count, 1, 'capacity must never be oversold under concurrent registration attempts');
});

test('canceling and re-registering reuses the same row rather than violating the duplicate-registration guard', async () => {
  const admin = await adminUser();
  const { profile, user } = await paidMember();
  const seminarId = await publishedSeminar(admin.id);
  await asMember(user.id, () => registerForSeminar(seminarId));
  await asMember(user.id, () => cancelOwnRegistration(seminarId));
  await asMember(user.id, () => registerForSeminar(seminarId));
  const rows = await sql`select registration_status from idoc.seminar_registrations where seminar_id=${seminarId} and profile_id=${profile.id}`;
  assert.equal(rows.length, 1, 're-registration must reuse the existing row, never insert a second one');
  assert.equal(rows[0].registration_status, 'registered');
});

test('registration status and payment status are independent facts: canceling never overwrites payment history', async () => {
  const admin = await adminUser();
  const { user } = await paidMember();
  const seminarId = await publishedSeminar(admin.id, { paymentMethodId: 'cash_event' });
  await asMember(user.id, () => registerForSeminar(seminarId));
  const [registrationRow] = await sql<{ id: number }[]>`select id from idoc.seminar_registrations where seminar_id=${seminarId}`;
  await asAdmin(admin.id, () => markRegistrationPaymentReceived(registrationRow.id));
  await asMember(user.id, () => cancelOwnRegistration(seminarId));
  const [after] = await sql`select registration_status,payment_status from idoc.seminar_registrations where id=${registrationRow.id}`;
  assert.equal(after.registration_status, 'canceled');
  assert.equal(after.payment_status, 'paid', 'canceling a registration must not erase its recorded payment status');
});

test('a member cannot view or act on another member\'s registration', async () => {
  const admin = await adminUser();
  const { user: owner } = await paidMember();
  const { user: intruder } = await paidMember();
  const seminarId = await publishedSeminar(admin.id);
  await asMember(owner.id, () => registerForSeminar(seminarId));
  await assert.rejects(asMember(intruder.id, () => cancelOwnRegistration(seminarId)), /No active registration/);
  const seminars = await asMember(intruder.id, () => listCurrentSeminarsForMember(null));
  const seen = seminars.find((row) => row.id === seminarId);
  assert.equal(seen?.registration_status ?? null, null, "another member's registration must never surface on a different member's own view");
});

test('an administrator cannot change the price or payment method once a seminar has any registration', async () => {
  const admin = await adminUser();
  const { user } = await paidMember();
  const seminarId = await publishedSeminar(admin.id);
  await asMember(user.id, () => registerForSeminar(seminarId));
  await assert.rejects(asAdmin(admin.id, () => updateSeminar(seminarId, seminarInput({ price: '99.00' }))), /price cannot change/i);
  await assert.rejects(asAdmin(admin.id, () => updateSeminar(seminarId, seminarInput({ paymentMethodId: 'cash_event' }))), /payment method cannot change/i);
  // An edit that leaves price/method untouched must still succeed.
  await asAdmin(admin.id, () => updateSeminar(seminarId, seminarInput({ title: 'Judging Clinic (Updated)' })));
  const updated = await asAdmin(admin.id, () => getAdminSeminar(seminarId));
  assert.equal(updated?.title, 'Judging Clinic (Updated)');
});

test('capacity cannot be reduced below the current number of active registrations', async () => {
  const admin = await adminUser();
  const { user: first } = await paidMember();
  const { user: second } = await paidMember();
  const seminarId = await publishedSeminar(admin.id, { capacity: 2 });
  await asMember(first.id, () => registerForSeminar(seminarId));
  await asMember(second.id, () => registerForSeminar(seminarId));
  await assert.rejects(asAdmin(admin.id, () => updateSeminar(seminarId, seminarInput({ capacity: 1 }))), /Capacity cannot be reduced/);
  await asAdmin(admin.id, () => updateSeminar(seminarId, seminarInput({ capacity: 2 })));
});

test('every seminar create, edit, status change, and registration mutation writes an audit entry', async () => {
  const admin = await adminUser();
  const { user } = await paidMember();
  const seminarId = await publishedSeminar(admin.id);
  await asAdmin(admin.id, () => updateSeminar(seminarId, seminarInput({ title: 'Renamed Clinic' })));
  await asMember(user.id, () => registerForSeminar(seminarId));
  const [registrationRow] = await sql<{ id: number }[]>`select id from idoc.seminar_registrations where seminar_id=${seminarId}`;
  await asAdmin(admin.id, () => markRegistrationPaymentReceived(registrationRow.id));
  await asMember(user.id, () => cancelOwnRegistration(seminarId));
  const actions = (await sql<{ action: string }[]>`select action from idoc.audit_log where entity_id=${String(seminarId)} or entity_id=${String(registrationRow.id)}`).map((row) => row.action);
  for (const expected of ['admin.seminar.created', 'admin.seminar.edited', 'member.seminar_registration.registered', 'member.seminar_registration.canceled']) {
    assert.ok(actions.includes(expected), `missing audit action: ${expected}`);
  }
});

test('a Stripe Checkout Session completion marks the exact registration paid, verified against this seminar\'s own price, and is idempotent on webhook replay', async () => {
  const admin = await adminUser();
  const { profile, user } = await paidMember();
  const seminarId = await publishedSeminar(admin.id, { price: '80.00' });
  const { registrationId } = await asMember(user.id, () => registerForSeminar(seminarId));

  const fakeListLineItems = { checkout: { sessions: { listLineItems: async () => ({ data: [] }) } } };
  const checkoutSessionId = `cs_${randomUUID()}`;
  await sql`update idoc.seminar_registrations set stripe_checkout_session_id=${checkoutSessionId},checkout_status='open',expected_amount_cents=8000,payment_status='pending' where id=${registrationId}`;
  const sessionCompleted = {
    amount_total: 8000, currency: 'eur', id: checkoutSessionId,
    metadata: { amountCents: '8000', currency: 'EUR', kind: 'seminar_registration', profileId: String(profile.id), registrationId: String(registrationId), seminarId: String(seminarId) },
    mode: 'payment', payment_intent: `pi_${randomUUID()}`, payment_status: 'paid',
  };
  const event = {
    api_version: '2025-08-27.basil', created: Math.floor(Date.now() / 1000),
    data: { object: sessionCompleted }, id: `evt_${randomUUID()}`, livemode: false,
    object: 'event', pending_webhooks: 0, request: { id: null, idempotency_key: null }, type: 'checkout.session.completed',
  };
  const result = await processStripeEvent(event as never, fakeListLineItems as never);
  assert.equal(result, 'processed');
  const [row] = await sql`select payment_status,paid_at,stripe_payment_intent_id from idoc.seminar_registrations where id=${registrationId}`;
  assert.equal(row.payment_status, 'paid');
  assert.ok(row.paid_at);
  assert.equal(row.stripe_payment_intent_id, sessionCompleted.payment_intent);

  // Membership entitlement must never be touched by a seminar payment (docs/02 §12).
  assert.equal((await sql`select count(*)::int as count from idoc.memberships where profile_id=${profile.id} and status='active' and starts_on>current_date - interval '1 day'`)[0].count, 0);
  assert.equal((await sql`select count(*)::int as count from idoc.payments where profile_id=${profile.id}`)[0].count, 0);

  // A replayed event id is a no-op (stripeEvents dedup); processing the exact same event id twice
  // must not somehow un-pay or re-audit the registration.
  const [{ count: beforeAuditCount }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.audit_log where entity_id=${String(registrationId)} and action='seminar.payment_confirmed'`;
  const replay = await processStripeEvent(event as never, fakeListLineItems as never);
  assert.equal(replay, 'duplicate');
  const [{ count: afterAuditCount }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.audit_log where entity_id=${String(registrationId)} and action='seminar.payment_confirmed'`;
  assert.equal(afterAuditCount, beforeAuditCount);
});

test('a Checkout Session priced against a different amount than this seminar\'s own fee never grants payment credit', async () => {
  const admin = await adminUser();
  const { profile, user } = await paidMember();
  const seminarId = await publishedSeminar(admin.id, { price: '80.00' });
  const { registrationId } = await asMember(user.id, () => registerForSeminar(seminarId));
  const fakeListLineItems = { checkout: { sessions: { listLineItems: async () => ({ data: [] }) } } };
  const checkoutSessionId = `cs_${randomUUID()}`;
  await sql`update idoc.seminar_registrations set stripe_checkout_session_id=${checkoutSessionId},checkout_status='open',expected_amount_cents=8000,payment_status='pending' where id=${registrationId}`;
  const event = {
    api_version: '2025-08-27.basil', created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        amount_total: 100, currency: 'eur', id: checkoutSessionId,
        metadata: { amountCents: '8000', currency: 'EUR', kind: 'seminar_registration', profileId: String(profile.id), registrationId: String(registrationId), seminarId: String(seminarId) },
        mode: 'payment', payment_intent: `pi_${randomUUID()}`, payment_status: 'paid',
      },
    },
    id: `evt_${randomUUID()}`, livemode: false, object: 'event', pending_webhooks: 0,
    request: { id: null, idempotency_key: null }, type: 'checkout.session.completed',
  };
  await processStripeEvent(event as never, fakeListLineItems as never);
  const [row] = await sql`select payment_status from idoc.seminar_registrations where id=${registrationId}`;
  assert.equal(row.payment_status, 'pending', 'a tampered/mismatched amount must never grant payment credit');
});

test('createSeminarCheckoutSession prices the session against the seminar\'s current fee and records the session id', async () => {
  const admin = await adminUser();
  const { user } = await paidMember();
  const seminarId = await publishedSeminar(admin.id, { price: '55.50' });
  const { registrationId } = await asMember(user.id, () => registerForSeminar(seminarId));
  const calls: unknown[] = [];
  const fakeClient = { checkout: { sessions: { create: async (params: unknown) => { calls.push(params); return { id: 'cs_fixture', url: 'https://checkout.stripe.com/session/fixture' }; } } }, customers: { create: async () => ({ id: 'cus_seminar_fixture' }) } };
  const url = await asMember(user.id, () => createSeminarCheckoutSession(registrationId, fakeClient));
  assert.equal(url, 'https://checkout.stripe.com/session/fixture');
  const params = calls[0] as { line_items: Array<{ price_data: { currency: string; unit_amount: number } }>; metadata: Record<string, string> };
  assert.equal(params.line_items[0].price_data.unit_amount, 5550);
  assert.equal(params.line_items[0].price_data.currency, 'eur');
  assert.equal(params.metadata.kind, 'seminar_registration');
  const [row] = await sql`select stripe_checkout_session_id from idoc.seminar_registrations where id=${registrationId}`;
  assert.equal(row.stripe_checkout_session_id, 'cs_fixture');
});

test('the production seminar refund flow uses authoritative payment state, persists full provider evidence, and rejects a succeeded retry', async () => {
  const admin = await adminUser();
  const { profile, user } = await paidMember();
  const seminarId = await publishedSeminar(admin.id, { price: '55.50' });
  const { registrationId } = await asMember(user.id, () => registerForSeminar(seminarId));
  await sql`update idoc.seminar_registrations set payment_status='paid',stripe_payment_intent_id='pi_authoritative',paid_at=now()
    where id=${registrationId}`;
  const providerCalls: Array<{ options: any; params: any }> = [];
  const provider = { refunds: { create: async (params: any, options: any) => {
    providerCalls.push({ options, params });
    return { id: 're_full_fixture', status: 'succeeded' } as never;
  } } };

  await asAdmin(admin.id, () => refundSeminarRegistration(registrationId, 'Approved full refund', provider));
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].params.amount, 5550);
  assert.equal(providerCalls[0].params.payment_intent, 'pi_authoritative');
  assert.equal(providerCalls[0].params.metadata.registrationId, String(registrationId));
  assert.match(providerCalls[0].options.idempotencyKey, new RegExp(`^idoc-seminar-refund-${registrationId}-pi_authoritative$`));
  const [registration] = await sql`select registration_status,payment_status,stripe_payment_intent_id from idoc.seminar_registrations where id=${registrationId}`;
  assert.deepEqual(registration, { payment_status: 'refunded', registration_status: 'canceled', stripe_payment_intent_id: 'pi_authoritative' });
  const [refund] = await sql`select amount_cents,currency,status,reason,external_refund_id,provider_evidence from idoc.payment_refunds where seminar_registration_id=${registrationId}`;
  assert.equal(refund.amount_cents, 5550);
  assert.equal(refund.currency, 'EUR');
  assert.equal(refund.status, 'succeeded');
  assert.equal(refund.external_refund_id, 're_full_fixture');
  assert.deepEqual(refund.provider_evidence, { id: 're_full_fixture', status: 'succeeded' });
  assert.equal((await sql`select count(*)::int count from idoc.memberships where profile_id=${profile.id}`)[0].count, 1);
  assert.equal((await sql`select count(*)::int count from idoc.payments where profile_id=${profile.id}`)[0].count, 0);

  await assert.rejects(asAdmin(admin.id, () => refundSeminarRegistration(registrationId, 'Repeat refund attempt', provider)), /already been refunded/);
  assert.equal(providerCalls.length, 1, 'a succeeded refund must never call Stripe again');
  assert.equal((await sql`select count(*)::int count from idoc.payment_refunds where seminar_registration_id=${registrationId}`)[0].count, 1);
});

test('admin registration search/filter finds a member by name or email and CSV export is capped, escaped, and audited', async () => {
  const admin = await adminUser();
  const { user } = await paidMember();
  const seminarId = await publishedSeminar(admin.id);
  await asMember(user.id, () => registerForSeminar(seminarId));
  const { rows } = await asAdmin(admin.id, () => listAdminSeminarRegistrations(seminarId, { q: user.email.split('@')[0] }));
  assert.equal(rows.length, 1);

  const exported = await asAdmin(admin.id, () => exportSeminarRegistrationsCsvRows(seminarId));
  assert.equal(exported.length, 1);
  assert.ok(Object.keys(exported[0]).every((key) => ['seminar_title', 'member_name', 'member_email', 'registration_status', 'payment_status', 'expected_amount_cents', 'currency', 'refund_ids', 'refunded_amount_cents', 'registered_at', 'canceled_at', 'paid_at'].includes(key)),
    'export rows must expose only the documented columns');
  const [auditRow] = await sql<{ after_json: { resultCount: number } }[]>`select after_json from idoc.audit_log where action='admin.seminar_registrations.exported' and entity_id=${String(seminarId)}`;
  assert.equal(auditRow.after_json.resultCount, 1);
});

test('the admin seminar list supports search and status filtering', async () => {
  const admin = await adminUser();
  await publishedSeminar(admin.id, { title: 'Alpha Clinic' });
  await asAdmin(admin.id, () => createSeminar(seminarInput({ status: 'draft', title: 'Beta Workshop' })));
  const { rows: published } = await asAdmin(admin.id, () => listAdminSeminars({ status: 'published' }));
  assert.ok(published.every((row) => row.status === 'published'));
  const { rows: searched } = await asAdmin(admin.id, () => listAdminSeminars({ q: 'Beta' }));
  assert.equal(searched.length, 1);
  assert.equal(searched[0].title, 'Beta Workshop');
});

test('past seminars only ever show this member\'s own registration history, and canceled seminars they never registered for do not leak into their current list', async () => {
  const admin = await adminUser();
  const { profile, user } = await paidMember();
  const registeredPastId = await asAdmin(admin.id, () => createSeminar(seminarInput({
    registrationDeadline: past(96), seminarDate: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10), startTime: '09:00', endTime: '10:00',
  })));
  await sql`insert into idoc.seminar_registrations (seminar_id,profile_id,payment_status) values (${registeredPastId},${profile.id},'paid')`;
  await asAdmin(admin.id, () => createSeminar(seminarInput({ status: 'canceled', title: 'Never Touched' })));

  const past_ = await asMember(user.id, () => listPastSeminarsForMember(profile.id));
  assert.equal(past_.length, 1);
  assert.equal(past_[0].id, registeredPastId);

  const current = await asMember(user.id, () => listCurrentSeminarsForMember(profile.id));
  assert.ok(!current.some((row) => row.title === 'Never Touched'), 'a canceled seminar this member never registered for must not appear in Current');
});

test('Bank Transfer instructions shown to a member are the same sanitized organization-wide instructions Super Admins maintain', async () => {
  await sql`update idoc.seminar_payment_methods set instructions_html=${'<p>Wire to IBAN DE00 0000 0000 0000 00</p><script>alert(1)</script>'} where canonical_id='bank_transfer'`;
  const html = await getSeminarPaymentMethodInstructions('bank_transfer');
  assert.match(String(html), /Wire to IBAN/);
});
