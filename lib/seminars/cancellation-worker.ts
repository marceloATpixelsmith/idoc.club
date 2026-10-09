import 'server-only';
import { outboxDeliveryHeld } from '@/lib/runtime/member-launch-hold';

import * as Sentry from '@sentry/nextjs';
import type Stripe from 'stripe';
import { client } from '@/lib/db/drizzle';
import { getStripeServerClient } from '@/lib/payments/stripe-client';
import { refundSeminarRegistrationCore, type RefundStripeClient } from '@/lib/payments/refunds';

type CancellationStripeClient = RefundStripeClient & {
  checkout: {
    sessions: {
      expire: (id: string) => Promise<unknown>;
      retrieve: (id: string) => Promise<Stripe.Checkout.Session>;
    };
  };
};

const BATCH_SIZE = 25;

/**
 * Resolves Stripe work left by seminar cancellation in bounded, resumable batches.
 * Registration/payment state is the durable queue: canceled online registrations remain
 * eligible until their refund succeeds or their open Checkout Session is expired.
 */
export async function processCanceledSeminarPayments(testStripe?: CancellationStripeClient): Promise<{ blocked: number; failed?: number; processed: number }> {
  if (outboxDeliveryHeld(true)) return { blocked: 1, processed: 0 };
  if (testStripe && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const stripe = testStripe ?? (getStripeServerClient() as CancellationStripeClient);
  const rows = await client<Array<{
    checkout_status: string | null;
    id: number;
    payment_status: string;
    stripe_checkout_session_id: string | null;
  }>>`select r.id,r.payment_status,r.checkout_status,r.stripe_checkout_session_id
    from seminar_registrations r
    join seminars s on s.id=r.seminar_id
    where s.status='canceled'
      and r.registration_status='canceled'
      and r.payment_method_canonical_id='online_stripe'
      and (
        r.payment_status in ('paid','refund_failed')
        or (r.stripe_checkout_session_id is not null and r.checkout_status='open')
      )
    order by r.updated_at asc,r.id asc
    limit ${BATCH_SIZE}`;

  let failed = 0;
  for (const row of rows) {
    try {
      if (row.payment_status === 'paid' || row.payment_status === 'refund_failed') {
        await refundSeminarRegistrationCore(row.id, 'Automatic full refund because the seminar was canceled.', null, stripe);
        continue;
      }
      if (!row.stripe_checkout_session_id) continue;
      const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
      if (session.payment_status === 'paid') {
        const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
        if (!paymentIntentId) throw new Error('Paid canceled seminar Checkout Session has no PaymentIntent.');
        await client`update seminar_registrations
          set stripe_payment_intent_id=${paymentIntentId},payment_status='paid',checkout_status='complete',
              paid_at=coalesce(paid_at,now()),payment_status_updated_at=now(),updated_at=now()
          where id=${row.id} and registration_status='canceled'`;
        await refundSeminarRegistrationCore(row.id, 'Automatic full refund because the seminar was canceled.', null, stripe);
      } else if (session.status === 'open') {
        await stripe.checkout.sessions.expire(row.stripe_checkout_session_id);
        await client`update seminar_registrations set checkout_status='expired',updated_at=now()
          where id=${row.id} and checkout_status='open'`;
      } else {
        await client`update seminar_registrations set checkout_status='expired',updated_at=now()
          where id=${row.id} and checkout_status='open'`;
      }
    } catch (error) {
      failed += 1;
      Sentry.captureException(error, { tags: { background_operation: 'seminar_cancellation_resolution' } });
      await client`insert into reconciliation_findings(kind,summary,details)
        values('seminar_payment_conflict','Canceled seminar payment requires retry or reconciliation.',
          ${JSON.stringify({ registrationId: row.id, message: error instanceof Error ? error.message : 'Unknown cancellation resolution error.' })}::jsonb)`;
      // Continue with the rest of the bounded batch. The registration remains eligible for a later run.
    }
  }
  return { blocked: 0, failed, processed: rows.length };
}
