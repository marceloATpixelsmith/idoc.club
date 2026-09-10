import 'server-only';

import type Stripe from 'stripe';
import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { resolveOrCreateBillingAccount } from '@/lib/payments/checkout';
import { getStripeServerClient } from '@/lib/payments/stripe-client';
import { baseUrlForServer } from '@/lib/runtime/configuration';
import { SeminarRegistrationError } from '@/lib/seminars/registrations';

export type SeminarCheckoutStripeClient = {
  checkout: { sessions: {
    create: (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => Promise<{ id: string; status?: string | null; url: string | null }>;
    retrieve?: (id: string) => Promise<{ status?: string | null; url: string | null }>;
  } };
  customers: { create: (params: Stripe.CustomerCreateParams, options?: Stripe.RequestOptions) => Promise<{ id: string }> };
};

/** Creates one server-priced EUR payment session. The row lock, stable Stripe idempotency key and
 * persisted open-session identity prevent parallel clicks from producing multiple active sessions. */
export async function createSeminarCheckoutSession(registrationIdValue: unknown, testStripeClient?: SeminarCheckoutStripeClient): Promise<string> {
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const actor = await requireAccountAccess('member');
  const registrationId = Number(registrationIdValue);
  if (!Number.isInteger(registrationId) || registrationId <= 0) throw new SeminarRegistrationError('Registration not found.');
  const [identity] = await client<{ profile_id: number; user_id: number }[]>`select r.profile_id,p.user_id from idoc.seminar_registrations r
    join idoc.profiles p on p.id=r.profile_id where r.id=${registrationId} limit 1`;
  if (!identity || identity.user_id !== actor.id) throw new SeminarRegistrationError('Registration not found.');
  const stripe = (testStripeClient ?? getStripeServerClient()) as SeminarCheckoutStripeClient;
  const customerId = await resolveOrCreateBillingAccount(stripe, actor.id, identity.profile_id);
  return client.begin(async (sql) => {
    const [row] = await sql<{
      checkout_status: string | null; payment_method_canonical_id: string; payment_status: string; price_cents: number; profile_id: number; registered_at: Date | string;
      registration_status: string; seminar_id: number; stripe_checkout_session_id: string | null; title: string;
    }[]>`select r.registration_status,r.payment_status,r.profile_id,r.seminar_id,r.stripe_checkout_session_id,r.checkout_status,r.registered_at,
      s.title,s.price_cents,s.payment_method_canonical_id from idoc.seminar_registrations r join idoc.seminars s on s.id=r.seminar_id
      where r.id=${registrationId} for update`;
    if (!row || row.profile_id !== identity.profile_id) throw new SeminarRegistrationError('Registration not found.');
    if (row.registration_status !== 'registered') throw new SeminarRegistrationError('This registration is not active.');
    if (row.payment_method_canonical_id !== 'online_stripe') throw new SeminarRegistrationError('This registration is not payable through Stripe.');
    if (['paid', 'refunded', 'partially_refunded', 'disputed', 'chargeback'].includes(row.payment_status)) throw new SeminarRegistrationError('This registration does not have an outstanding Stripe payment.');
    if (row.price_cents <= 0) throw new SeminarRegistrationError('This seminar has no fee to collect.');
    if (row.stripe_checkout_session_id && row.checkout_status === 'open' && stripe.checkout.sessions.retrieve) {
      const existing = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
      if (existing.status === 'open' && existing.url) return existing.url;
      await sql`update idoc.seminar_registrations set checkout_status=${existing.status === 'expired' ? 'expired' : 'superseded'},updated_at=now() where id=${registrationId}`;
    }
    const baseUrl = baseUrlForServer();
    const cycle = new Date(row.registered_at).getTime();
    const session = await stripe.checkout.sessions.create({
      cancel_url: `${baseUrl}/seminars?checkout=canceled`, customer: customerId,
      line_items: [{ price_data: { currency: 'eur', product_data: { name: row.title }, unit_amount: row.price_cents }, quantity: 1 }],
      metadata: { amountCents: String(row.price_cents), currency: 'EUR', kind: 'seminar_registration',
        profileId: String(row.profile_id), registrationId: String(registrationId), seminarId: String(row.seminar_id) },
      mode: 'payment', payment_intent_data: { metadata: { kind: 'seminar_registration', registrationId: String(registrationId) } },
      success_url: `${baseUrl}/seminars?checkout=success`,
    }, { idempotencyKey: `idoc-seminar-checkout-${registrationId}-${cycle}` });
    if (!session.url) throw new Error('Stripe did not return a Checkout Session URL.');
    await sql`update idoc.seminar_registrations set stripe_checkout_session_id=${session.id},checkout_status='open',
      checkout_created_at=now(),expected_amount_cents=${row.price_cents},currency='EUR',payment_status='pending',payment_status_updated_at=now(),updated_at=now()
      where id=${registrationId}`;
    return session.url;
  });
}
