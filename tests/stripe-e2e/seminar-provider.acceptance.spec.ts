import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import Stripe from 'stripe';
import { withTestMembershipBoundary } from '../../lib/membership/test-boundary';
import { refundSeminarRegistration } from '../../lib/payments/refunds';

const memberEmail = process.env.STRIPE_E2E_MEMBER_EMAIL as string;
const sql = postgres(process.env.TEST_DATABASE_URL as string, { max: 1 });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

type Registration = {
  audit_count: number;
  checkout_status: string;
  currency: string;
  customer_id: string;
  expected_amount_cents: number;
  membership_count: number;
  payment_status: string;
  price_cents: number;
  profile_id: number;
  registration_id: number;
  registration_status: string;
  seminar_id: number;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
};

async function registration(): Promise<Registration> {
  const [row] = await sql<Registration[]>`select r.id registration_id,r.profile_id,r.seminar_id,r.registration_status,r.payment_status,
    r.stripe_checkout_session_id,r.stripe_payment_intent_id,r.checkout_status,r.expected_amount_cents,r.currency,s.price_cents,
    b.external_customer_id customer_id,(select count(*)::int from idoc.memberships m where m.profile_id=r.profile_id) membership_count,
    (select count(*)::int from idoc.audit_log a where a.entity_type='seminar_registration' and a.entity_id=r.id::text) audit_count
    from idoc.seminar_registrations r join idoc.seminars s on s.id=r.seminar_id
    join idoc.profiles p on p.id=r.profile_id join idoc.users u on u.id=p.user_id
    join idoc.billing_accounts b on b.profile_id=r.profile_id where u.email=${memberEmail} order by r.id desc limit 1`;
  expect(row).toBeTruthy();
  return row;
}

async function postVerifiedEvent(event: Stripe.Event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET as string });
  const response = await fetch(new URL('/api/stripe/webhook', process.env.STRIPE_E2E_APP_URL), {
    body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': signature }, method: 'POST',
  });
  expect(response.status).toBe(200);
}

function completedEvent(session: Stripe.Checkout.Session, overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Event {
  return {
    api_version: '2025-08-27.basil', created: Math.floor(Date.now() / 1000),
    data: { object: { ...session, ...overrides } }, id: `evt_idoc_acceptance_${randomUUID()}`,
    livemode: false, object: 'event', pending_webhooks: 0, request: null, type: 'checkout.session.completed',
  } as Stripe.Event;
}

async function fillStripeCard(page: import('@playwright/test').Page) {
  await page.getByLabel(/card number/i).fill('4242424242424242');
  await page.getByLabel(/expiration/i).fill('1230');
  await page.getByLabel(/security code|cvc/i).fill('123');
  await page.getByRole('button', { name: /pay|complete/i }).click();
  await page.waitForURL(/seminars/, { timeout: 60_000 });
}

test.describe.serial('Stripe test-mode seminar acceptance', () => {
  let sessionId = '';
  let sessionUrl = '';
  let paidRegistration: Registration;

  test('SEMINAR-CHECKOUT-PROVIDER retrieves the exact server-created Session and ignores client-controlled payment fields', async ({ page }) => {
    await page.goto('/seminars?view=available');
    const card = page.locator('section[aria-labelledby="available-seminars-heading"] li').filter({ hasText: 'Stripe E2E Seminar A' });
    const button = card.getByRole('button', { name: /register/i });
    await button.evaluate((element) => {
      const form = element.closest('form');
      if (!form) throw new Error('Seminar registration form missing.');
      for (const [name, value] of Object.entries({ amount: '1', currency: 'usd', customer: 'cus_forged',
        payment_intent: 'pi_forged', profileId: '999999', registrationId: '999999' })) {
        const input = document.createElement('input'); input.name = name; input.value = value; form.append(input);
      }
      const seminar = form.querySelector<HTMLInputElement>('input[name="seminarId"]');
      if (seminar) seminar.dataset.authoritativeValue = seminar.value;
    });
    await button.dblclick();
    await page.waitForURL(/checkout\.stripe\.com/);
    sessionUrl = page.url();
    sessionId = page.url().match(/cs_[A-Za-z0-9_]+/)?.[0] ?? '';
    expect(sessionId).toMatch(/^cs_test_/);

    const local = await registration();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items', 'payment_intent'] });
    expect(session.livemode).toBe(false);
    expect(session.id).toBe(local.stripe_checkout_session_id);
    expect(typeof session.customer === 'string' ? session.customer : session.customer?.id).toBe(local.customer_id);
    expect(session.metadata).toMatchObject({ amountCents: String(local.price_cents), currency: 'EUR',
      kind: 'seminar_registration', profileId: String(local.profile_id), registrationId: String(local.registration_id),
      seminarId: String(local.seminar_id) });
    expect(session.amount_total).toBe(local.price_cents);
    expect(session.currency).toBe('eur');
    expect(local.payment_status).toBe('pending');
    expect(local.registration_status).toBe('registered');
    expect(local.membership_count).toBe(1);
  });

  test('SEMINAR-WEBHOOK-INTEGRITY rejects amount, currency, ownership, registration, seminar, Customer, and PaymentIntent mismatches then credits once', async ({ page }) => {
    const paidBeforeMismatch = await stripe.checkout.sessions.retrieve(sessionId);
    expect(paidBeforeMismatch.livemode).toBe(false);
    await page.goto(sessionUrl);
    await fillStripeCard(page);
    const provider = await stripe.checkout.sessions.retrieve(sessionId);
    expect(provider.livemode).toBe(false);
    expect(provider.payment_status).toBe('paid');
    const before = await registration();
    const mismatches: Partial<Stripe.Checkout.Session>[] = [
      { amount_total: before.price_cents + 1 }, { currency: 'usd' },
      { customer: 'cus_forged' }, { payment_intent: 'pi_forged' },
      { metadata: { ...provider.metadata, profileId: '999999' } },
      { metadata: { ...provider.metadata, registrationId: '999999' } },
      { metadata: { ...provider.metadata, seminarId: '999999' } },
    ];
    for (const mismatch of mismatches) await postVerifiedEvent(completedEvent(provider, { payment_status: 'paid', ...mismatch }));
    expect((await registration()).payment_status).toBe('pending');

    const paidProvider = await stripe.checkout.sessions.retrieve(sessionId);
    const event = completedEvent(paidProvider);
    await postVerifiedEvent(event);
    paidRegistration = await registration();
    expect(paidRegistration.payment_status).toBe('paid');
    expect(paidRegistration.registration_status).toBe('registered');
    expect(paidRegistration.stripe_payment_intent_id).toMatch(/^pi_/);
    expect(paidRegistration.membership_count).toBe(before.membership_count);
    const auditCount = paidRegistration.audit_count;
    await postVerifiedEvent(event);
    const replayed = await registration();
    expect(replayed.audit_count).toBe(auditCount);
    expect(replayed.membership_count).toBe(before.membership_count);
  });

  test('SEMINAR-REFUND-PROVIDER uses authoritative state, verifies the Stripe Refund, and is idempotent', async ({ page }) => {
    const denied = await page.goto('/admin/seminars');
    expect(denied?.status()).toBeGreaterThanOrEqual(300);
    await expect(page.locator('body')).not.toContainText(/pi_|cus_|reconciliation finding/i);

    const [admin] = await sql<{ id: number }[]>`insert into idoc.users(email,password_hash,email_verified_at,account_state)
      values(${`stripe-e2e-admin-${randomUUID()}@example.test`},'disabled',now(),'active') returning id`;
    await sql`insert into idoc.application_roles(user_id,role) values(${admin.id},'administrator')`;
    await withTestMembershipBoundary({ actor: { id: admin.id, roles: ['administrator'] } }, () =>
      refundSeminarRegistration(paidRegistration.registration_id, 'Provider acceptance refund'));

    const [evidence] = await sql<{ amount_cents: number; external_refund_id: string; rows: number }[]>`select amount_cents,external_refund_id,
      count(*) over()::int rows from idoc.payment_refunds where seminar_registration_id=${paidRegistration.registration_id}`;
    const refund = await stripe.refunds.retrieve(evidence.external_refund_id, { expand: ['payment_intent'] });
    const intent = typeof refund.payment_intent === 'string'
      ? await stripe.paymentIntents.retrieve(refund.payment_intent) : refund.payment_intent;
    expect((refund as unknown as Record<string, unknown>).livemode).toBe(false);
    expect(refund.amount).toBe(paidRegistration.price_cents);
    expect(refund.metadata).toMatchObject({ kind: 'seminar_registration', registrationId: String(paidRegistration.registration_id), testRun: memberEmail });
    expect(intent?.id).toBe(paidRegistration.stripe_payment_intent_id);
    expect(intent?.currency).toBe('eur');
    const projected = await registration();
    expect(projected).toMatchObject({ payment_status: 'refunded', registration_status: 'canceled' });
    expect(projected.membership_count).toBe(paidRegistration.membership_count);
    await expect(withTestMembershipBoundary({ actor: { id: admin.id, roles: ['administrator'] } }, () =>
      refundSeminarRegistration(paidRegistration.registration_id, 'Duplicate provider acceptance refund'))).rejects.toThrow(/already been refunded/i);
    const [after] = await sql<{ count: number }[]>`select count(*)::int count from idoc.payment_refunds where seminar_registration_id=${paidRegistration.registration_id}`;
    expect(after.count).toBe(evidence.rows);
  });
});
