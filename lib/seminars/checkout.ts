import 'server-only';
import { assertLiveBillingAllowed } from '@/lib/runtime/member-launch-hold';

import type Stripe from 'stripe';
import { deferAdminNotification, notifyCheckoutStartFailure } from '@/lib/notifications/admin-event-alerts';
import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { resolveOrCreateBillingAccount } from '@/lib/payments/checkout';
import { getStripeServerClient } from '@/lib/payments/stripe-client';
import { baseUrlForServer } from '@/lib/runtime/configuration';
import { SeminarRegistrationError } from '@/lib/seminars/registrations';

function seminarCheckoutDeliveryOwner(baseUrl: string): 'production' | 'staging' {
  return new URL(baseUrl).hostname === 'staging.idoc.club' ? 'staging' : 'production';
}

export type SeminarCheckoutStripeClient = {
  checkout: { sessions: {
    create: (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => Promise<{ id: string; status?: string | null; url: string | null }>;
    retrieve?: (id: string) => Promise<{ status?: string | null; url: string | null }>;
  } };
  customers: { create: (params: Stripe.CustomerCreateParams, options?: Stripe.RequestOptions) => Promise<{ id: string }> };
};

/** Creates one server-priced EUR payment session for an existing member (profile-backed) registration.
 * Registration is members-only, so a registration without a profile can never be paid for here. */
export async function createSeminarCheckoutSession(registrationIdValue: unknown, testStripeClient?: SeminarCheckoutStripeClient): Promise<string> {
  assertLiveBillingAllowed('billing.createSeminarCheckoutSession');
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const registrationId = Number(registrationIdValue);
  if (!Number.isInteger(registrationId) || registrationId <= 0) throw new SeminarRegistrationError('Registration not found.');
  const stripe = (testStripeClient ?? getStripeServerClient()) as SeminarCheckoutStripeClient;
  //RESOLVE AUTHORIZATION AND STRIPE CUSTOMER OUTSIDE THE ROW-LOCKING TRANSACTION.
  //THESE HELPERS USE THE SHARED DATABASE CLIENT AND MUST NOT WAIT FOR A SECOND
  //CONNECTION WHILE THE TRANSACTION IS HOLDING A POOL CONNECTION.
  const [identity] = await client<{ profile_id: number | null; user_id: number | null }[]>`select r.profile_id,p.user_id
    from seminar_registrations r left join profiles p on p.id=r.profile_id
    where r.id=${registrationId}`;
  if (!identity || identity.profile_id === null) throw new SeminarRegistrationError('Registration not found.');
  const actor = await requireAccountAccess('member');
  if (identity.user_id !== actor.id) throw new SeminarRegistrationError('Registration not found.');
  const memberCustomer = { customerId: await resolveOrCreateBillingAccount(stripe, actor.id, identity.profile_id), profileId: identity.profile_id, userId: actor.id };
  return client.begin(async (sql) => {
    const [row] = await sql<{
      checkout_status: string | null; email: string | null; payment_method_canonical_id: string; payment_status: string;
      price_cents: number; profile_id: number | null; registered_at: Date | string; registration_status: string; seminar_id: number;
      stripe_checkout_session_id: string | null; title: string; user_id: number | null;
    }[]>`select r.registration_status,r.payment_status,r.profile_id,r.seminar_id,r.stripe_checkout_session_id,r.checkout_status,r.registered_at,
      r.payment_method_canonical_id,s.title,coalesce(r.expected_amount_cents, s.member_price_cents) price_cents,
      p.user_id,u.email from seminar_registrations r join seminars s on s.id=r.seminar_id
      left join profiles p on p.id=r.profile_id left join users u on u.id=p.user_id
      where r.id=${registrationId} for update of r`;
    if (!row) throw new SeminarRegistrationError('Registration not found.');
    //RECHECK THE LOCKED ROW IN CASE IT CHANGED AFTER PREFLIGHT AUTHORIZATION.
    if (row.profile_id === null || row.user_id !== memberCustomer.userId || row.profile_id !== memberCustomer.profileId) {
      throw new SeminarRegistrationError('Registration not found.');
    }
    const email = row.email;
    const customerId = memberCustomer.customerId;
    if (row.registration_status !== 'registered') throw new SeminarRegistrationError('This registration is not active.');
    if (row.payment_method_canonical_id !== 'online_stripe') throw new SeminarRegistrationError('This registration is not payable through Stripe.');
    if (['paid', 'refunded', 'partially_refunded', 'disputed', 'chargeback'].includes(row.payment_status)) throw new SeminarRegistrationError('This registration does not have an outstanding Stripe payment.');
    if (row.price_cents <= 0) throw new SeminarRegistrationError('This seminar has no fee to collect.');
    if (row.stripe_checkout_session_id && row.checkout_status === 'open' && stripe.checkout.sessions.retrieve) {
      const existing = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
      if (existing.status === 'open' && existing.url) return existing.url;
      await sql`update seminar_registrations set checkout_status=${existing.status === 'expired' ? 'expired' : 'superseded'},updated_at=now() where id=${registrationId}`;
    }
    const baseUrl = baseUrlForServer();
    const deliveryOwner = seminarCheckoutDeliveryOwner(baseUrl);
    const checkoutKind = deliveryOwner === 'staging' ? 'seminar_registration_staging' : 'seminar_registration';
    const cycle = new Date(row.registered_at).getTime();
    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
    try {
    session = await stripe.checkout.sessions.create({
      cancel_url: `${baseUrl}/api/ui/flash/seminar-checkout/canceled/${row.seminar_id}`,
      customer: customerId,
      line_items: [{ price_data: { currency: 'eur', product_data: { name: row.title }, unit_amount: row.price_cents }, quantity: 1 }],
      metadata: { amountCents: String(row.price_cents), currency: 'EUR', deliveryOwner, kind: checkoutKind,
        ...(deliveryOwner === 'staging' ? { seminarProfileId: String(row.profile_id) } : { profileId: String(row.profile_id) }),
        registrationId: String(registrationId), seminarId: String(row.seminar_id),
        ...(email?.startsWith('stripe-e2e-') && email.endsWith('@example.test') ? { testRun: email } : {}) },
      mode: 'payment', payment_intent_data: { metadata: { deliveryOwner, kind: checkoutKind, registrationId: String(registrationId),
        ...(email?.startsWith('stripe-e2e-') && email.endsWith('@example.test') ? { testRun: email } : {}) } },
      success_url: `${baseUrl}/seminars?view=my`,
    }, { idempotencyKey: `idoc-seminar-checkout-${registrationId}-${cycle}` });
    } catch (error) {
      // Stripe could not create the payment page: tell the Billing assignees, then fail the member's request as before.
      deferAdminNotification(() => notifyCheckoutStartFailure({ error, extra: [['Seminar', row.title]], kind: 'seminar', profileId: row.profile_id, registrationId }));
      throw error;
    }
    if (!session.url) throw new Error('Stripe did not return a Checkout Session URL.');
    await sql`update seminar_registrations set stripe_checkout_session_id=${session.id},checkout_status='open',
      checkout_created_at=now(),expected_amount_cents=${row.price_cents},currency='EUR',payment_status='pending',payment_status_updated_at=now(),updated_at=now()
      where id=${registrationId}`;
    return session.url;
  });
}
