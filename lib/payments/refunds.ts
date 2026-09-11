import 'server-only';

import type Stripe from 'stripe';
import { client } from '@/lib/db/drizzle';
import { requireAdministrator } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { getStripeServerClient } from './stripe-client';

export class RefundError extends Error { constructor(message: string) { super(message); this.name = 'RefundError'; } }
export type RefundStripeClient = {
  refunds: { create: (params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions) => Promise<Stripe.Refund> };
  invoices?: { retrieve: (id: string, params?: Stripe.InvoiceRetrieveParams) => Promise<Stripe.Invoice> };
  subscriptions?: { cancel: (id: string, params?: Stripe.SubscriptionCancelParams, options?: Stripe.RequestOptions) => Promise<unknown> };
};
function reason(value: unknown) { const parsed = String(value ?? '').trim(); if (parsed.length < 5 || parsed.length > 1000) throw new RefundError('A refund reason of 5–1000 characters is required.'); return parsed; }
function refundStatus(value: string | null): 'canceled' | 'failed' | 'pending' | 'succeeded' {
  if (value === 'succeeded' || value === 'failed' || value === 'canceled') return value; return 'pending';
}

export async function refundSeminarRegistration(registrationIdValue: unknown, reasonValue: unknown, testStripe?: RefundStripeClient) {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor);
  const registrationId = Number(registrationIdValue); if (!Number.isInteger(registrationId) || registrationId <= 0) throw new RefundError('Registration not found.');
  const explanation = reason(reasonValue);
  const [row] = await client<{ payment_status: string; price_cents: number; stripe_payment_intent_id: string | null }[]>`select r.payment_status,r.stripe_payment_intent_id,s.price_cents
    from idoc.seminar_registrations r join idoc.seminars s on s.id=r.seminar_id where r.id=${registrationId} limit 1`;
  if (!row || !row.stripe_payment_intent_id) throw new RefundError('No Stripe seminar payment was found.');
  if (row.payment_status === 'refunded') return;
  if (row.payment_status !== 'paid' && row.payment_status !== 'refund_failed') throw new RefundError('Only a confirmed full seminar payment can be refunded.');
  const baseKey = `idoc-seminar-refund-${registrationId}-${row.stripe_payment_intent_id}`;
  const [priorAttempt] = await client<{ id: number; status: string; external_refund_id: string | null; failure_code: string | null }[]>`select id,status,external_refund_id,failure_code
    from idoc.payment_refunds where seminar_registration_id=${registrationId} order by requested_at desc,id desc limit 1`;
  // Preserve the original idempotency key when Stripe's outcome is uncertain. A terminal Stripe
  // failure is different: Stripe has confirmed that no refund was created, so the administrator's
  // retry must create a new durable attempt and use a fresh provider idempotency key.
  const terminalFailure = priorAttempt?.status === 'failed' && priorAttempt.external_refund_id !== null &&
    priorAttempt.failure_code === null;
  const key = terminalFailure ? `${baseKey}-retry-${Date.now()}` : baseKey;
  const [request] = await client<{ id: number }[]>`insert into idoc.payment_refunds(seminar_registration_id,idempotency_key,amount_cents,status,reason,administrator_id)
    values(${registrationId},${key},${row.price_cents},'pending',${explanation},${actor.id}) on conflict(idempotency_key) do update set updated_at=now() returning id`;
  const stripe = testStripe ?? getStripeServerClient();
  try {
    const refund = await stripe.refunds.create({ amount: row.price_cents, metadata: { kind: 'seminar_registration', registrationId: String(registrationId) }, payment_intent: row.stripe_payment_intent_id }, { idempotencyKey: key });
    const status = refundStatus(refund.status);
    await client.begin(async (sql) => {
      await sql`update idoc.payment_refunds set external_refund_id=${refund.id},status=${status},provider_evidence=${JSON.stringify({ id: refund.id, status: refund.status })}::jsonb,
        refunded_at=${status === 'succeeded' ? new Date() : null},updated_at=now() where id=${request.id}`;
      await sql`update idoc.seminar_registrations set registration_status='canceled',canceled_at=coalesce(canceled_at,now()),
        payment_status=${status === 'succeeded' ? 'refunded' : status === 'failed' ? 'refund_failed' : 'paid'},payment_status_updated_at=now(),updated_at=now() where id=${registrationId}`;
      await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values(${actor.id},'admin.seminar_payment.refund_requested','seminar_registration',${String(registrationId)},${JSON.stringify({ amountCents: row.price_cents, reason: explanation, refundId: refund.id, status })}::jsonb)`;
      if (status === 'succeeded') await sql`insert into idoc.notification_outbox(profile_id,kind,payload,dedupe_key)
        select r.profile_id,'seminar.refund_confirmed',jsonb_build_object('amountCents',${row.price_cents},'refundId',${refund.id},'registrationId',${registrationId},'to',u.email,'firstName',p.first_name),${`seminar.refund_confirmed:${refund.id}`}
        from idoc.seminar_registrations r join idoc.profiles p on p.id=r.profile_id join idoc.users u on u.id=p.user_id where r.id=${registrationId} on conflict(dedupe_key) do nothing`;
    });
    if (status === 'failed') throw new RefundError('Stripe reported that the refund failed.');
  } catch (error) {
    if (error instanceof RefundError) throw error;
    // Never overwrite provider-confirmed evidence. A later local failure is a reconciliation issue, not a failed Stripe refund.\n    await client`update idoc.payment_refunds set status='failed',failure_code='stripe_request_failed',updated_at=now() where id=${request.id} and external_refund_id is null`;
    await client`update idoc.seminar_registrations set payment_status='refund_failed',payment_status_updated_at=now(),updated_at=now() where id=${registrationId}`;
    throw new RefundError('Stripe could not complete the refund. The payment was preserved for reconciliation.');
  }
}

export async function refundMembershipPayment(paymentIdValue: unknown, reasonValue: unknown, testStripe?: RefundStripeClient) {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor);
  const paymentId = Number(paymentIdValue); if (!Number.isInteger(paymentId) || paymentId <= 0) throw new RefundError('Payment not found.');
  const explanation = reason(reasonValue);
  const [payment] = await client<{ amount_cents: number; external_payment_id: string | null; profile_id: number; source: string }[]>`select profile_id,source,external_payment_id,amount_cents from idoc.payments where id=${paymentId}`;
  if (!payment?.external_payment_id || !['stripe_recurring','stripe_one_time'].includes(payment.source)) throw new RefundError('Only a Stripe membership payment can be refunded.');
  const key = `idoc-membership-refund-${paymentId}-${payment.external_payment_id}`;
  const [request] = await client<{ id: number }[]>`insert into idoc.payment_refunds(membership_payment_id,idempotency_key,amount_cents,status,reason,administrator_id)
    values(${paymentId},${key},${payment.amount_cents},'pending',${explanation},${actor.id}) on conflict(idempotency_key) do update set updated_at=now() returning id`;
  const stripe = testStripe ?? getStripeServerClient();
  let paymentIntent = payment.external_payment_id;
  if (payment.source === 'stripe_recurring') {
    if (!stripe.invoices) throw new RefundError('Stripe invoice lookup is unavailable.');
    const invoice = await stripe.invoices.retrieve(payment.external_payment_id, { expand: ['payments.data.payment.payment_intent'] });
    const intent = invoice.payments?.data.find((item) => item.status === 'paid')?.payment.payment_intent;
    paymentIntent = typeof intent === 'string' ? intent : intent?.id ?? '';
    if (!paymentIntent) throw new RefundError('The recurring charge has no refundable Payment Intent.');
  }
  try {
    const refund = await stripe.refunds.create({ amount: payment.amount_cents, metadata: { kind: 'membership_payment', paymentId: String(paymentId) }, payment_intent: paymentIntent }, { idempotencyKey: key });
    const status = refundStatus(refund.status);
    await client`update idoc.payment_refunds set external_refund_id=${refund.id},status=${status},provider_evidence=${JSON.stringify({ id: refund.id, status: refund.status })}::jsonb,
      refunded_at=${status === 'succeeded' ? new Date() : null},updated_at=now() where id=${request.id}`;
    if (status === 'succeeded' && payment.source === 'stripe_recurring') {
      const [subscription] = await client<{ external_subscription_id: string }[]>`select external_subscription_id from idoc.subscriptions
        where profile_id=${payment.profile_id} and status in ('active','trialing','past_due','incomplete') order by updated_at desc limit 1`;
      if (subscription) {
        if (!stripe.subscriptions) {
          await client`insert into idoc.reconciliation_findings(kind,profile_id,summary,details) values('status_conflict',${payment.profile_id},'Membership refund succeeded but automatic renewal could not be disabled.',${JSON.stringify({ paymentId, refundId: refund.id })}::jsonb)`;
          throw new RefundError('The refund succeeded, but automatic renewal could not be disabled. Reconciliation is required.');
        }
        await stripe.subscriptions.cancel(subscription.external_subscription_id, {}, { idempotencyKey: `${key}-cancel-renewal` });
        await client`update idoc.subscriptions set status='canceled',cancel_at_period_end=false,updated_at=now() where external_subscription_id=${subscription.external_subscription_id}`;
      }
      await client`insert into idoc.renewal_preferences(profile_id,current_mode,transition_state) values(${payment.profile_id},'non_recurring','current')
        on conflict(profile_id) do update set current_mode='non_recurring',pending_mode=null,effective_on=null,transition_state='current',updated_at=now()`;
    }
    await client`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values(${actor.id},'admin.membership_payment.refund_requested','payment',${String(paymentId)},${JSON.stringify({ amountCents: payment.amount_cents, reason: explanation, refundId: refund.id, status })}::jsonb)`;
    if (status === 'failed') throw new RefundError('Stripe reported that the refund failed.');
  } catch (error) {
    if (error instanceof RefundError) throw error;
    await client`update idoc.payment_refunds set status='failed',failure_code='stripe_request_failed',updated_at=now() where id=${request.id}`;
    throw new RefundError('Stripe could not complete the refund. The original payment was preserved.');
  }
}
