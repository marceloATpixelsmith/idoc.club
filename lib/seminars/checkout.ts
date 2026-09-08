import 'server-only';

import type Stripe from 'stripe';
import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { baseUrlForServer } from '@/lib/runtime/configuration';
import { getStripeServerClient } from '@/lib/payments/stripe-client';
import { SeminarRegistrationError } from '@/lib/seminars/registrations';

// Same minimal structural subset pattern as lib/payments/checkout.ts's CheckoutStripeClient --
// only the one call this module makes, so tests can inject a fake without satisfying the entire
// real Stripe SDK surface.
export type SeminarCheckoutStripeClient = {
  checkout: { sessions: { create: (params: Stripe.Checkout.SessionCreateParams) => Promise<{ id: string; url: string | null }> } };
};

/**
 * Creates a Checkout Session for one seminar registration's fee, priced ad hoc via inline
 * `price_data` (no persisted Stripe Product is required per seminar, unlike the one canonical
 * membership Product). Seminar payments are classified separately from membership billing and
 * never touch membership entitlement (docs/02 §12): this only ever writes to
 * `idoc.seminar_registrations`, never `idoc.payments` or `idoc.memberships`.
 */
export async function createSeminarCheckoutSession(registrationIdValue: unknown, testStripeClient?: SeminarCheckoutStripeClient): Promise<string> {
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const actor = await requireAccountAccess('member');
  const registrationId = Number(registrationIdValue);
  if (!Number.isInteger(registrationId) || registrationId <= 0) throw new SeminarRegistrationError('Registration not found.');
  const [row] = await client<{
    price_cents: number; profile_id: number; registration_status: string; seminar_id: number; title: string; user_id: number;
  }[]>`select r.registration_status,r.profile_id,r.seminar_id,s.title,s.price_cents,p.user_id
    from idoc.seminar_registrations r join idoc.seminars s on s.id=r.seminar_id join idoc.profiles p on p.id=r.profile_id
    where r.id=${registrationId} limit 1`;
  if (!row || row.user_id !== actor.id) throw new SeminarRegistrationError('Registration not found.');
  if (row.registration_status !== 'registered') throw new SeminarRegistrationError('This registration is not active.');
  if (row.price_cents <= 0) throw new SeminarRegistrationError('This seminar has no fee to collect.');
  const stripe = testStripeClient ?? getStripeServerClient();
  const baseUrl = baseUrlForServer();
  const session = await stripe.checkout.sessions.create({
    cancel_url: `${baseUrl}/seminars`,
    line_items: [{
      price_data: { currency: 'eur', product_data: { name: row.title }, unit_amount: row.price_cents },
      quantity: 1,
    }],
    metadata: { kind: 'seminar_registration', profileId: String(row.profile_id), registrationId: String(registrationId) },
    mode: 'payment',
    success_url: `${baseUrl}/seminars?checkout=success`,
  });
  if (!session.url) throw new Error('Stripe did not return a Checkout Session URL.');
  await client`update idoc.seminar_registrations set stripe_checkout_session_id=${session.id},updated_at=now() where id=${registrationId}`;
  return session.url;
}
