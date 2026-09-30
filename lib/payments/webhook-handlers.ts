import 'server-only';

import type Stripe from 'stripe';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, billingAccounts, membershipCheckoutSessions, memberships, notificationOutbox, paymentRefunds, payments, profiles, reconciliationFindings, renewalPreferences, seminarRegistrations, seminars, stripeEvents, subscriptions, users } from '@/lib/db/schema';
import { stripeMembershipProductIdForServer } from '@/lib/runtime/configuration';
import { lockLatestMembership, type Transaction } from '@/lib/membership/locking';
import { sendTransactionalEmail } from '@/lib/notifications/brevo-transactional';
import { escapeHtml, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { getSeminarEmailDetails, guestRegistrationConfirmationBodyHtml } from '@/lib/seminars/registrations';
import { MEMBERSHIP_CURRENCY, MEMBERSHIP_FEE_CENTS } from './pricing';
import { gracePeriodEnd, nextValidUntil } from './renewal';

// Only the one call this module makes, and only the fields it actually reads back, so tests can
// inject a fake without satisfying the entire real Stripe SDK surface (same pattern as
// lib/payments/checkout.ts's CheckoutStripeClient). The real client structurally satisfies this.
export type WebhookStripeClient = {
  checkout: {
    sessions: {
      listLineItems: (sessionId: string) => Promise<{ data: Array<{ price: { id: string; product: string | { id: string } } | null }> }>;
      retrieve?: (sessionId: string) => Promise<Stripe.Checkout.Session>;
    };
  };
  setupIntents?: { retrieve: (id: string) => Promise<Stripe.SetupIntent> };
  paymentMethods?: { retrieve: (id: string) => Promise<Stripe.PaymentMethod> };
  prices?: { create: (params: Stripe.PriceCreateParams, options?: Stripe.RequestOptions) => Promise<Stripe.Price> };
  refunds?: { create: (params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions) => Promise<Stripe.Refund> };
  subscriptions?: { cancel: (id: string, params?: Stripe.SubscriptionCancelParams, options?: Stripe.RequestOptions) => Promise<unknown> };
  subscriptionSchedules?: { create: (params: Stripe.SubscriptionScheduleCreateParams, options?: Stripe.RequestOptions) => Promise<Stripe.SubscriptionSchedule> };
};

function resolvedCustomerId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

async function resolveProfileId(tx: Transaction, externalCustomerId: string | null): Promise<number | null> {
  if (!externalCustomerId) return null;
  const [billing] = await tx.select({ profileId: billingAccounts.profileId }).from(billingAccounts)
    .where(eq(billingAccounts.externalCustomerId, externalCustomerId)).limit(1);
  return billing?.profileId ?? null;
}

async function handleSubscriptionCreated(tx: Transaction, event: Stripe.Event, _stripe: WebhookStripeClient) {
  const subscription = event.data.object as Stripe.Subscription;
  const profileId = await resolveProfileId(tx, resolvedCustomerId(subscription.customer));
  if (!profileId) return;
  const item = subscription.items.data[0];
  await tx.insert(subscriptions).values({
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString().slice(0, 10),
    externalSubscriptionId: subscription.id,
    priceId: item.price.id,
    profileId,
    status: subscription.status,
  }).onConflictDoNothing({ target: subscriptions.externalSubscriptionId });
  await tx.insert(renewalPreferences).values({ currentMode: 'recurring', profileId })
    .onConflictDoNothing({ target: renewalPreferences.profileId });
  const scheduleId = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id;
  if (scheduleId) await tx.update(renewalPreferences).set({ currentMode: 'recurring', effectiveOn: null,
    pendingMode: null, transitionState: 'current', updatedAt: new Date() })
    .where(and(eq(renewalPreferences.profileId, profileId), eq(renewalPreferences.externalSubscriptionScheduleId, scheduleId)));
}

async function handleSubscriptionUpdated(tx: Transaction, event: Stripe.Event, _stripe: WebhookStripeClient) {
  const subscription = event.data.object as Stripe.Subscription;
  const profileId = await resolveProfileId(tx, resolvedCustomerId(subscription.customer));
  if (!profileId) return;
  const item = subscription.items.data[0];
  await tx.update(subscriptions).set({
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString().slice(0, 10),
    priceId: item.price.id,
    status: subscription.status,
    updatedAt: new Date(),
  }).where(and(eq(subscriptions.externalSubscriptionId, subscription.id), eq(subscriptions.profileId, profileId)));
  if (subscription.cancel_at_period_end) await tx.insert(renewalPreferences).values({ currentMode: 'recurring',
    effectiveOn: new Date(item.current_period_end * 1000).toISOString().slice(0, 10), pendingMode: 'non_recurring',
    profileId, transitionState: 'cancel_pending' }).onConflictDoUpdate({ target: renewalPreferences.profileId,
    set: { currentMode: 'recurring', effectiveOn: new Date(item.current_period_end * 1000).toISOString().slice(0, 10),
      pendingMode: 'non_recurring', transitionState: 'cancel_pending', updatedAt: new Date() } });
}

async function handleSubscriptionDeleted(tx: Transaction, event: Stripe.Event, _stripe: WebhookStripeClient) {
  const subscription = event.data.object as Stripe.Subscription;
  const profileId = await resolveProfileId(tx, resolvedCustomerId(subscription.customer));
  if (!profileId) return;
  // Recurring billing has ended, but membership access continues through the already-paid
  // valid_until date (docs/02 §3) — nothing in `memberships` changes here.
  await tx.update(subscriptions).set({ status: subscription.status, updatedAt: new Date() })
    .where(and(eq(subscriptions.externalSubscriptionId, subscription.id), eq(subscriptions.profileId, profileId)));
  await tx.insert(renewalPreferences).values({ currentMode: 'non_recurring', profileId })
    .onConflictDoUpdate({ target: renewalPreferences.profileId, set: { currentMode: 'non_recurring',
      effectiveOn: null, pendingMode: null, transitionState: 'current', updatedAt: new Date() } });
}

async function handleInvoicePaid(tx: Transaction, event: Stripe.Event, _stripe: WebhookStripeClient) {
  const invoice = event.data.object as Stripe.Invoice;
  if (invoice.amount_paid !== MEMBERSHIP_FEE_CENTS || invoice.currency.toLowerCase() !== MEMBERSHIP_CURRENCY) return;
  const profileId = await resolveProfileId(tx, resolvedCustomerId(invoice.customer));
  if (!profileId) return;
  const expectedProduct = stripeMembershipProductIdForServer();
  const invoicePrices = invoice.lines.data.flatMap((line) => line.pricing?.price_details?.price ? [line.pricing.price_details.price] : []);
  const hasExpectedProduct = invoice.lines.data.some((line) => line.pricing?.price_details?.product === expectedProduct);
  const [legacySubscription] = invoicePrices.length > 0 ? await tx.select({ id: subscriptions.id }).from(subscriptions)
    .where(and(eq(subscriptions.profileId, profileId), inArray(subscriptions.priceId, invoicePrices))).limit(1) : [];
  if (!hasExpectedProduct && !legacySubscription) return;
  const paidAt = invoice.status_transitions.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date();
  const [inserted] = await tx.insert(payments).values({
    amountCents: invoice.amount_paid,
    currency: invoice.currency.toUpperCase(),
    externalPaymentId: invoice.id,
    paidAt,
    profileId,
    source: 'stripe_recurring',
  }).onConflictDoNothing({ target: payments.externalPaymentId }).returning({ id: payments.id });
  if (!inserted) return;
  await tx.insert(renewalPreferences).values({ currentMode: 'recurring', profileId })
    .onConflictDoNothing({ target: renewalPreferences.profileId });
  const membership = await lockLatestMembership(tx, profileId);
  // A suspended membership (administrator action, or self-service cancellation -- see
  // cancelOwnMembership) must never be silently reactivated by a Stripe event that was already in
  // flight at the moment of suspension/cancellation. The payment itself is still recorded above --
  // money genuinely changed hands and needs to stay reconcilable -- but entitlement is left exactly
  // as the member/administrator set it, and the conflict is surfaced for manual review instead.
  if (membership?.status === 'suspended') {
    await tx.insert(reconciliationFindings).values({ kind: 'status_conflict', profileId,
      summary: 'Stripe reported a successful renewal payment for a membership that is currently suspended; entitlement was not restored automatically.',
      details: { invoiceId: invoice.id, paymentId: inserted.id } });
    return;
  }
  const validUntil = nextValidUntil({ currentValidUntil: membership?.validUntil ?? null, paidAt: paidAt.toISOString().slice(0, 10) });
  if (membership) {
    await tx.update(memberships).set({ graceEndsOn: null, status: 'active', updatedAt: new Date(), validUntil })
      .where(eq(memberships.id, membership.id));
  } else {
    await tx.insert(memberships).values({
      membershipType: 'standard', profileId, source: 'stripe',
      startsOn: paidAt.toISOString().slice(0, 10), status: 'active', validUntil,
    });
  }
}

async function handleInvoicePaymentFailed(tx: Transaction, event: Stripe.Event, _stripe: WebhookStripeClient) {
  const invoice = event.data.object as Stripe.Invoice;
  const profileId = await resolveProfileId(tx, resolvedCustomerId(invoice.customer));
  if (!profileId) return;
  const membership = await lockLatestMembership(tx, profileId);
  // Stripe's Smart Retries fire a distinct invoice.payment_failed event (distinct event.id, so
  // stripeEvents's dedup doesn't catch it) on every retry attempt for the same unpaid invoice. Only
  // the transition into grace should move validUntil/send a notice — an already-'grace' membership
  // means this is a later retry, not a new failure, and must be a no-op. A 'suspended' membership
  // (administrator action, or self-service cancellation) must not be moved into grace either -- that
  // would imply access continues until grace ends, contradicting the suspension/cancellation.
  if (!membership || membership.status === 'grace' || membership.status === 'suspended') return;
  // Stripe's invoice period start is the authoritative scheduled-renewal date. The fallback is
  // retained only for legacy/test invoices that predate that field.
  const failedRenewalDate = invoice.period_start
    ? new Date(invoice.period_start * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const graceEnd = gracePeriodEnd(failedRenewalDate);
  await tx.update(memberships).set({ graceEndsOn: graceEnd, status: 'grace', updatedAt: new Date() })
    .where(eq(memberships.id, membership.id));
  const [contact] = await tx.select({ email: users.email, firstName: profiles.firstName })
    .from(profiles).innerJoin(users, eq(profiles.userId, users.id)).where(eq(profiles.id, profileId)).limit(1);
  await tx.insert(notificationOutbox).values({
    dedupeKey: `membership.payment_failed:${profileId}:${graceEnd}`,
    kind: 'membership.payment_failed',
    payload: { firstName: contact?.firstName, graceEndDate: graceEnd, to: contact?.email },
    profileId,
  }).onConflictDoNothing({ target: notificationOutbox.dedupeKey });
}

// Record/flag only — no entitlement change until a real success or failure event arrives. The
// stripeEvents row processStripeEvent writes for every event is itself the flag; nothing further
// to persist here in Phase 1 (admin surfacing of this state is Phase 3 scope).
async function handleInvoicePaymentActionRequired(_tx: Transaction, _event: Stripe.Event, _stripe: WebhookStripeClient) {
  return undefined;
}

function checkoutCustomText(session: Stripe.Checkout.Session, key: string): string {
  const field = session.custom_fields?.find((candidate) => candidate.key === key);
  return field?.text?.value?.trim() ?? '';
}

async function refundGuestCheckoutWithoutRegistration(tx: Transaction, session: Stripe.Checkout.Session, stripe: WebhookStripeClient, reason: string) {
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntentId || !stripe.refunds || !session.amount_total) {
    await tx.insert(reconciliationFindings).values({ kind: 'seminar_payment_conflict',
      summary: 'A paid guest seminar Checkout could not be converted to a registration and requires manual refund review.',
      details: { reason, sessionId: session.id, paymentIntentId: paymentIntentId ?? null } });
    return;
  }
  try {
    const refund = await stripe.refunds.create({ amount: session.amount_total,
      metadata: { kind: 'seminar_guest_registration', seminarId: session.metadata?.seminarId ?? '' },
      payment_intent: paymentIntentId }, { idempotencyKey: `idoc-guest-seminar-refund-${session.id}` });
    await tx.insert(reconciliationFindings).values({ kind: 'seminar_payment_conflict',
      summary: 'A paid guest seminar Checkout was automatically refunded because no valid registration could be created.',
      details: { reason, sessionId: session.id, paymentIntentId, refundId: refund.id, refundStatus: refund.status } });
  } catch (error) {
    await tx.insert(reconciliationFindings).values({ kind: 'seminar_payment_conflict',
      summary: 'Automatic refund failed for a paid guest seminar Checkout that could not become a registration.',
      details: { reason, sessionId: session.id, paymentIntentId, message: error instanceof Error ? error.message : 'Stripe refund request failed.' } });
  }
}

/** Stripe-first anonymous registration. No guest identity is collected or persisted by IDOC before
 * payment. The verified Checkout Session supplies first name, last name, email and phone; only then
 * is the guest seminar registration created. */
async function handleGuestSeminarCheckoutSessionCompleted(tx: Transaction, deliveredSession: Stripe.Checkout.Session, stripe: WebhookStripeClient) {
  const session = stripe.checkout.sessions.retrieve ? await stripe.checkout.sessions.retrieve(deliveredSession.id) : deliveredSession;
  const seminarId = Number(session.metadata?.seminarId);
  const firstName = checkoutCustomText(session, 'first_name');
  const lastName = checkoutCustomText(session, 'last_name');
  const email = session.customer_details?.email?.trim().toLowerCase() ?? '';
  const phone = session.customer_details?.phone?.trim() ?? '';
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  const contactFieldsFitStorage = firstName.length <= 100 && lastName.length <= 100 && `${firstName} ${lastName}`.length <= 200 && email.length <= 255 && phone.length <= 40;
  if (!Number.isInteger(seminarId) || !paymentIntentId || session.payment_status !== 'paid' || !firstName || !lastName || !email || !phone || !contactFieldsFitStorage) {
    await refundGuestCheckoutWithoutRegistration(tx, session, stripe, 'Stripe Checkout was missing required verified registration data.');
    return;
  }

  const [seminar] = await tx.select({ capacity: seminars.capacity, nonMemberPriceCents: seminars.nonMemberPriceCents,
    registrationDeadline: seminars.registrationDeadline, status: seminars.status, title: seminars.title })
    .from(seminars).where(eq(seminars.id, seminarId)).limit(1).for('update');
  const expectedAmount = seminar?.nonMemberPriceCents ?? null;
  const validPayment = Boolean(seminar) && session.amount_total === expectedAmount &&
    session.metadata?.amountCents === String(expectedAmount) && session.metadata?.currency === 'EUR' &&
    session.currency?.toLowerCase() === 'eur';
  if (!seminar || !validPayment || seminar.status !== 'published' || new Date(seminar.registrationDeadline).getTime() <= Date.now()) {
    await refundGuestCheckoutWithoutRegistration(tx, session, stripe, 'Seminar state or authoritative price no longer matched Checkout.');
    return;
  }

  const [existing] = await tx.select({ id: seminarRegistrations.id }).from(seminarRegistrations)
    .where(and(eq(seminarRegistrations.seminarId, seminarId), sql`lower(${seminarRegistrations.guestEmail}) = ${email}`)).limit(1);
  if (existing) {
    await refundGuestCheckoutWithoutRegistration(tx, session, stripe, 'This email already has a registration for the seminar.');
    return;
  }
  const [{ activeCount }] = await tx.select({ activeCount: sql<number>`count(*)::int` }).from(seminarRegistrations)
    .where(and(eq(seminarRegistrations.seminarId, seminarId), eq(seminarRegistrations.registrationStatus, 'registered')));
  if (activeCount >= seminar.capacity) {
    await refundGuestCheckoutWithoutRegistration(tx, session, stripe, 'The seminar filled before Checkout completed.');
    return;
  }

  const [created] = await tx.insert(seminarRegistrations).values({
    checkoutCreatedAt: new Date(), checkoutStatus: 'complete', currency: 'EUR', expectedAmountCents: expectedAmount,
    guestEmail: email, guestFirstName: firstName, guestLastName: lastName, guestName: `${firstName} ${lastName}`,
    guestPhone: phone, markedPaidByUserId: null, paidAt: new Date(), paymentMethodCanonicalId: 'online_stripe',
    paymentStatus: 'paid', paymentStatusUpdatedAt: new Date(), registrationStatus: 'registered', seminarId,
    stripeCheckoutSessionId: session.id, stripePaymentIntentId: paymentIntentId,
  }).returning({ id: seminarRegistrations.id });
  await tx.insert(auditLog).values({ action: 'guest.seminar_registration.registered_and_paid',
    afterJson: { amountCents: expectedAmount, sessionId: session.id }, entityId: String(created.id), entityType: 'seminar_registration' });
  try {
    await sendTransactionalEmail({
      html: renderTransactionalEmail({ bodyHtml: await guestRegistrationConfirmationBodyHtml({ firstName, paymentMethod: 'online_stripe', seminar: (await getSeminarEmailDetails(seminarId))! }),
        heading: `Thank you for registering for ${escapeHtml(seminar.title)}` }),
      subject: 'Your IDOC seminar registration', to: email,
    }, { signal: AbortSignal.timeout(10_000) });
  } catch { /* best-effort; payment and registration are already durable */ }
}

// Seminar payments are classified separately from membership billing and never touch membership
// entitlement (docs/02 §12) -- this only ever updates idoc.seminar_registrations, distinguished
// from a membership checkout entirely by the `kind` metadata createSeminarCheckoutSession sets, so
// it can never be confused with the membership one-time-fee path below even if amounts coincide.
async function handleSeminarCheckoutSessionCompleted(tx: Transaction, deliveredSession: Stripe.Checkout.Session, stripe: WebhookStripeClient) {
  // Stripe's retrieval response, rather than browser input or even the delivered event body, is
  // authoritative for provider-controlled payment/customer fields in production.
  const session = stripe.checkout.sessions.retrieve
    ? await stripe.checkout.sessions.retrieve(deliveredSession.id)
    : deliveredSession;
  const registrationId = Number(session.metadata?.registrationId);
  // A guest checkout's metadata carries no profileId at all (see createSeminarCheckoutSession);
  // treat that absence as `null` rather than `Number(undefined)` (NaN) or `Number('')` (0), so it
  // compares equal to the guest registration's own real `null` profileId below.
  const metadataProfileIdRaw = session.metadata?.profileId;
  const metadataProfileId = metadataProfileIdRaw ? Number(metadataProfileIdRaw) : null;
  const metadataSeminarId = Number(session.metadata?.seminarId);
  if (!Number.isInteger(registrationId) || (metadataProfileId !== null && !Number.isInteger(metadataProfileId)) || !Number.isInteger(metadataSeminarId)) return;
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntentId) return;
  const [registration] = await tx.select({ checkoutSessionId: seminarRegistrations.stripeCheckoutSessionId,
    expectedAmountCents: seminarRegistrations.expectedAmountCents, guestEmail: seminarRegistrations.guestEmail,
    guestName: seminarRegistrations.guestName, memberPriceCents: seminars.memberPriceCents,
    nonMemberPriceCents: seminars.nonMemberPriceCents, paymentStatus: seminarRegistrations.paymentStatus,
    profileId: seminarRegistrations.profileId, registrationStatus: seminarRegistrations.registrationStatus,
    seminarId: seminarRegistrations.seminarId, customerId: billingAccounts.externalCustomerId }).from(seminarRegistrations)
    .innerJoin(seminars, eq(seminars.id, seminarRegistrations.seminarId))
    .leftJoin(billingAccounts, eq(billingAccounts.profileId, seminarRegistrations.profileId))
    .where(eq(seminarRegistrations.id, registrationId)).limit(1);
  if (!registration) return;
  // Grant credit only against this seminar's own current fee, matching the amount/currency
  // tamper check the membership one-time-fee path already performs (docs/04 §3). A guest has no
  // billing-account Customer to match, so that half of the check only applies to members.
  const priceCents = registration.profileId === null ? registration.nonMemberPriceCents : registration.memberPriceCents;
  const valid = registration.registrationStatus === 'registered' && registration.profileId === metadataProfileId &&
    registration.seminarId === metadataSeminarId && registration.checkoutSessionId === session.id &&
    registration.expectedAmountCents === priceCents && session.amount_total === priceCents &&
    session.metadata?.amountCents === String(priceCents) && session.metadata?.currency === 'EUR' &&
    session.currency?.toLowerCase() === 'eur' && session.payment_status === 'paid' &&
    (registration.profileId === null || resolvedCustomerId(session.customer) === registration.customerId);
  if (!valid) {
    const isCanceledPayment = registration.registrationStatus === 'canceled' && registration.profileId === metadataProfileId &&
      registration.seminarId === metadataSeminarId && registration.checkoutSessionId === session.id &&
      registration.expectedAmountCents === priceCents && session.amount_total === priceCents && session.currency?.toLowerCase() === 'eur' &&
      session.payment_status === 'paid';
    if (isCanceledPayment && stripe.refunds) {
      const idempotencyKey = `idoc-seminar-refund-${registrationId}-${paymentIntentId}`;
      let refund: Stripe.Refund;
      try {
        refund = await stripe.refunds.create({ amount: priceCents, metadata: { kind: 'seminar_registration', registrationId: String(registrationId) }, payment_intent: paymentIntentId }, { idempotencyKey });
      } catch (error) {
        await tx.insert(paymentRefunds).values({ amountCents: priceCents, failureCode: 'stripe_request_failed',
          idempotencyKey, providerEvidence: { message: error instanceof Error ? error.message : 'Stripe refund request failed.' },
          reason: 'Automatic full refund after concurrent payment for a canceled seminar.',
          seminarRegistrationId: registrationId, status: 'failed' })
          .onConflictDoUpdate({ target: paymentRefunds.idempotencyKey, set: { failureCode: 'stripe_request_failed', status: 'failed', updatedAt: new Date() } });
        await tx.update(seminarRegistrations).set({ checkoutStatus: 'complete', paidAt: new Date(), paymentStatus: 'refund_failed',
          paymentStatusUpdatedAt: new Date(), stripePaymentIntentId: paymentIntentId, updatedAt: new Date() })
          .where(eq(seminarRegistrations.id, registrationId));
        await tx.insert(reconciliationFindings).values({ kind: 'seminar_payment_conflict', profileId: registration.profileId,
          summary: 'Automatic refund failed for a payment completed after seminar cancellation.',
          details: { registrationId, sessionId: session.id, paymentIntentId } });
        return;
      }
      const status = refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' ? 'failed' : refund.status === 'canceled' ? 'canceled' : 'pending';
      await tx.insert(paymentRefunds).values({ amountCents: priceCents, externalRefundId: refund.id, idempotencyKey,
        providerEvidence: { id: refund.id, status: refund.status }, reason: 'Automatic full refund after concurrent payment for a canceled seminar.',
        refundedAt: status === 'succeeded' ? new Date() : null, seminarRegistrationId: registrationId, status })
        .onConflictDoNothing({ target: paymentRefunds.idempotencyKey });
      await tx.update(seminarRegistrations).set({ checkoutStatus: 'complete', paidAt: new Date(),
        paymentStatus: status === 'succeeded' ? 'refunded' : status === 'failed' ? 'refund_failed' : 'paid',
        paymentStatusUpdatedAt: new Date(), stripePaymentIntentId: paymentIntentId, updatedAt: new Date() })
        .where(eq(seminarRegistrations.id, registrationId));
      await tx.insert(auditLog).values({ action: 'seminar.canceled_payment_refunded',
        afterJson: { amountCents: priceCents, paymentIntentId, refundId: refund.id, status }, entityId: String(registrationId), entityType: 'seminar_registration' });
      return;
    }
    await tx.insert(reconciliationFindings).values({ kind: 'seminar_payment_conflict', profileId: registration.profileId,
      summary: 'A paid seminar Checkout Session did not match its active local registration.',
      details: { registrationId, sessionId: session.id, paymentIntentId } });
    return;
  }
  const updated = await tx.update(seminarRegistrations).set({
    markedPaidByUserId: null, paidAt: new Date(), paymentStatus: 'paid', stripePaymentIntentId: paymentIntentId, updatedAt: new Date(),
    checkoutStatus: 'complete', paymentStatusUpdatedAt: new Date(),
  }).where(and(eq(seminarRegistrations.id, registrationId), eq(seminarRegistrations.registrationStatus, 'registered'),
    ne(seminarRegistrations.paymentStatus, 'paid')))
    .returning({ id: seminarRegistrations.id });
  if (!updated[0]) return;
  await tx.insert(auditLog).values({
    action: 'seminar.payment_confirmed', afterJson: { amountCents: priceCents, paymentIntentId, sessionId: session.id },
    entityId: String(registrationId), entityType: 'seminar_registration',
  });
  if (registration.profileId !== null) {
    const [contact] = await tx.select({ email: users.email, firstName: profiles.firstName }).from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId)).where(eq(profiles.id, registration.profileId)).limit(1);
    await tx.insert(notificationOutbox).values({ dedupeKey: `seminar.payment_confirmed:${registrationId}:${paymentIntentId}`,
      kind: 'seminar.payment_confirmed', payload: { amountCents: priceCents, firstName: contact?.firstName,
        registrationId, to: contact?.email }, profileId: registration.profileId })
      .onConflictDoNothing({ target: notificationOutbox.dedupeKey });
  } else if (registration.guestEmail) {
    // Guests have no profile row, so notification_outbox (profile_id NOT NULL) can't queue this --
    // send directly and best-effort, the same way registerAsGuestForSeminar's own confirmation does.
    try {
      await sendTransactionalEmail({
        html: renderTransactionalEmail({
          bodyHtml: `<p>Hello ${escapeHtml(registration.guestName ?? '')},</p><p>Your payment for this seminar was received. Thank you.</p>`,
          heading: 'Seminar payment confirmed',
        }),
        subject: 'Your IDOC seminar payment', to: registration.guestEmail,
      }, { signal: AbortSignal.timeout(10_000) });
    } catch { /* best-effort -- the payment itself already committed above */ }
  }
}

async function handleRefundChanged(tx: Transaction, refund: Stripe.Refund, stripe: WebhookStripeClient) {
  const status = refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' ? 'failed' : refund.status === 'canceled' ? 'canceled' : 'pending';
  const [knownRefund] = await tx.select({ id: paymentRefunds.id, membershipPaymentId: paymentRefunds.membershipPaymentId })
    .from(paymentRefunds).where(eq(paymentRefunds.externalRefundId, refund.id)).limit(1);
  if (knownRefund?.membershipPaymentId) {
    await tx.update(paymentRefunds).set({ providerEvidence: { id: refund.id, status: refund.status }, status, updatedAt: new Date(),
      refundedAt: status === 'succeeded' ? new Date() : null }).where(eq(paymentRefunds.id, knownRefund.id));
    if (status === 'succeeded') {
      const [payment] = await tx.select({ profileId: payments.profileId, source: payments.source }).from(payments).where(eq(payments.id, knownRefund.membershipPaymentId)).limit(1);
      if (payment?.source === 'stripe_recurring') {
        const [subscription] = await tx.select({ externalSubscriptionId: subscriptions.externalSubscriptionId }).from(subscriptions)
          .where(and(eq(subscriptions.profileId, payment.profileId), inArray(subscriptions.status, ['active', 'trialing', 'past_due', 'incomplete'])))
          .orderBy(desc(subscriptions.updatedAt)).limit(1);
        if (subscription && stripe.subscriptions) {
          await stripe.subscriptions.cancel(subscription.externalSubscriptionId, {}, { idempotencyKey: `idoc-membership-refund-${refund.id}-cancel-renewal` });
          await tx.update(subscriptions).set({ status: 'canceled', cancelAtPeriodEnd: false, updatedAt: new Date() }).where(eq(subscriptions.externalSubscriptionId, subscription.externalSubscriptionId));
        }
        await tx.update(renewalPreferences).set({ currentMode: 'non_recurring', pendingMode: null, effectiveOn: null, transitionState: 'current', updatedAt: new Date() }).where(eq(renewalPreferences.profileId, payment.profileId));
      }
    }
    return;
  }
  const paymentIntentId = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
  if (!paymentIntentId) return;
  const [registration] = await tx.select({ id: seminarRegistrations.id, guestEmail: seminarRegistrations.guestEmail,
    guestName: seminarRegistrations.guestName, memberPriceCents: seminars.memberPriceCents,
    nonMemberPriceCents: seminars.nonMemberPriceCents, profileId: seminarRegistrations.profileId })
    .from(seminarRegistrations).innerJoin(seminars, eq(seminars.id, seminarRegistrations.seminarId))
    .where(eq(seminarRegistrations.stripePaymentIntentId, paymentIntentId)).limit(1);
  if (!registration) {
    await tx.insert(reconciliationFindings).values({ kind: 'refund_conflict', summary: 'Stripe reported a refund without a matching local seminar payment.',
      details: { paymentIntentId, refundId: refund.id, status: refund.status } });
    return;
  }
  const priceCents = registration.profileId === null ? registration.nonMemberPriceCents : registration.memberPriceCents;
  const amount = refund.amount;
  const [existing] = await tx.select({ id: paymentRefunds.id }).from(paymentRefunds).where(eq(paymentRefunds.externalRefundId, refund.id)).limit(1);
  if (existing) await tx.update(paymentRefunds).set({ providerEvidence: { id: refund.id, status: refund.status }, status, updatedAt: new Date(),
    refundedAt: status === 'succeeded' ? new Date() : null }).where(eq(paymentRefunds.id, existing.id));
  else await tx.insert(paymentRefunds).values({ amountCents: amount, currency: 'EUR', externalRefundId: refund.id,
    idempotencyKey: `stripe-reported-${refund.id}`, providerEvidence: { id: refund.id, status: refund.status }, reason: 'Initiated directly in Stripe',
    refundedAt: status === 'succeeded' ? new Date() : null, seminarRegistrationId: registration.id, status });
  const full = amount === priceCents;
  await tx.update(seminarRegistrations).set({ paymentStatus: status === 'failed' ? 'refund_failed' :
    status === 'succeeded' ? (full ? 'refunded' : 'partially_refunded') : 'paid', paymentStatusUpdatedAt: new Date(),
    registrationStatus: status === 'succeeded' && full ? 'canceled' : undefined,
    canceledAt: status === 'succeeded' && full ? new Date() : undefined, updatedAt: new Date() }).where(eq(seminarRegistrations.id, registration.id));
  if (!full || !existing) await tx.insert(reconciliationFindings).values({ kind: 'refund_conflict', profileId: registration.profileId,
    summary: full ? 'A Stripe-initiated seminar refund requires administrator review.' : 'Stripe reported a partial seminar refund, which is outside IDOC policy.',
    details: { amount, expectedAmount: priceCents, refundId: refund.id } });
  if (status === 'succeeded') {
    if (registration.profileId !== null) {
      const [contact] = await tx.select({ email: users.email, firstName: profiles.firstName }).from(profiles)
        .innerJoin(users, eq(users.id, profiles.userId)).where(eq(profiles.id, registration.profileId)).limit(1);
      await tx.insert(notificationOutbox).values({ dedupeKey: `seminar.refund_confirmed:${refund.id}`,
        kind: 'seminar.refund_confirmed', payload: { amountCents: amount, firstName: contact?.firstName,
          refundId: refund.id, registrationId: registration.id, to: contact?.email }, profileId: registration.profileId })
        .onConflictDoNothing({ target: notificationOutbox.dedupeKey });
    } else if (registration.guestEmail) {
      try {
        await sendTransactionalEmail({
          html: renderTransactionalEmail({
            bodyHtml: `<p>Hello ${escapeHtml(registration.guestName ?? '')},</p><p>Your seminar refund has been processed.</p>`,
            heading: 'Seminar refund confirmed',
          }),
          subject: 'Your IDOC seminar refund', to: registration.guestEmail,
        }, { signal: AbortSignal.timeout(10_000) });
      } catch { /* best-effort -- the refund record itself already committed above */ }
    }
  }
}

async function handleChargeRefunded(tx: Transaction, event: Stripe.Event, stripe: WebhookStripeClient) {
  const charge = event.data.object as Stripe.Charge;
  for (const refund of charge.refunds?.data ?? []) await handleRefundChanged(tx, refund, stripe);
}

async function handleRefundEvent(tx: Transaction, event: Stripe.Event, stripe: WebhookStripeClient) {
  await handleRefundChanged(tx, event.data.object as Stripe.Refund, stripe);
}

async function handleDispute(tx: Transaction, event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute;
  const paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
  const [registration] = paymentIntentId ? await tx.select({ id: seminarRegistrations.id, profileId: seminarRegistrations.profileId })
    .from(seminarRegistrations).where(eq(seminarRegistrations.stripePaymentIntentId, paymentIntentId)).limit(1) : [];
  const chargeback = event.type === 'charge.dispute.closed' && dispute.status === 'lost';
  await tx.insert(reconciliationFindings).values({ kind: chargeback ? 'chargeback' : 'dispute', profileId: registration?.profileId,
    summary: chargeback ? 'A Stripe seminar chargeback requires operational review.' : 'A Stripe dispute requires operational review.',
    details: { disputeId: dispute.id, paymentIntentId, status: dispute.status } });
  if (registration) await tx.update(seminarRegistrations).set({ chargebackAt: chargeback ? new Date() : undefined,
    disputedAt: new Date(), paymentStatus: chargeback ? 'chargeback' : 'disputed', paymentStatusUpdatedAt: new Date(), updatedAt: new Date() })
    .where(eq(seminarRegistrations.id, registration.id));
}

async function handleCheckoutSessionCompleted(tx: Transaction, event: Stripe.Event, stripe: WebhookStripeClient) {
  const session = event.data.object as Stripe.Checkout.Session;
  await tx.update(membershipCheckoutSessions).set({ status: 'completed', updatedAt: new Date() })
    .where(eq(membershipCheckoutSessions.externalCheckoutSessionId, session.id));
  if (session.mode === 'setup' && session.metadata?.kind === 'membership_renewal_setup') {
    const customerId = resolvedCustomerId(session.customer);
    const profileId = await resolveProfileId(tx, customerId);
    const metadataProfileId = Number(session.metadata.profileId);
    if (!profileId || profileId !== metadataProfileId || !customerId || typeof session.setup_intent !== 'string') return;
    const [preference] = await tx.select().from(renewalPreferences).where(and(
      eq(renewalPreferences.profileId, profileId), eq(renewalPreferences.externalCheckoutSessionId, session.id),
    )).limit(1);
    if (!preference || preference.pendingMode !== 'recurring' || preference.transitionState !== 'awaiting_setup' || !preference.effectiveOn) return;
    // Lock and reread the authoritative paid-through membership before creating any future Stripe charge schedule.
    // A one-time renewal or administrative extension may have changed valid_until after Setup Checkout began.
    const membership = await lockLatestMembership(tx, profileId);
    if (!membership || membership.validUntil !== preference.effectiveOn) {
      await tx.update(renewalPreferences).set({ transitionState: 'failed', updatedAt: new Date() })
        .where(eq(renewalPreferences.profileId, profileId));
      await tx.insert(reconciliationFindings).values({ kind: 'pending_schedule_conflict', profileId,
        summary: 'Renewal Setup completed after the authoritative paid-through date changed.',
        details: { checkoutSessionId: session.id, expectedEffectiveOn: preference.effectiveOn,
          currentValidUntil: membership?.validUntil ?? null } });
      return;
    }
    if (!stripe.setupIntents || !stripe.paymentMethods || !stripe.prices || !stripe.subscriptionSchedules) {
      throw new Error('Stripe renewal APIs are unavailable.');
    }
    const setupIntent = await stripe.setupIntents.retrieve(session.setup_intent);
    const setupCustomerId = resolvedCustomerId(setupIntent.customer);
    const paymentMethodId = typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method?.id;
    if (setupIntent.status !== 'succeeded' || setupIntent.usage !== 'off_session' || setupCustomerId !== customerId || !paymentMethodId) return;
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (resolvedCustomerId(paymentMethod.customer) !== customerId) return;
    const price = await stripe.prices.create({ currency: MEMBERSHIP_CURRENCY, product: stripeMembershipProductIdForServer(),
      recurring: { interval: 'year' }, unit_amount: MEMBERSHIP_FEE_CENTS },
    { idempotencyKey: `idoc-renewal-price-${profileId}-${preference.effectiveOn}` });
    const startDate = Math.floor(new Date(`${preference.effectiveOn}T00:00:00.000Z`).getTime() / 1000);
    let schedule;
    try {
      schedule = await stripe.subscriptionSchedules.create({ customer: customerId,
        default_settings: { collection_method: 'charge_automatically', default_payment_method: paymentMethodId },
        end_behavior: 'release', metadata: { kind: 'idoc_membership', profileId: String(profileId) },
        phases: [{ items: [{ price: price.id, quantity: 1 }], metadata: { kind: 'idoc_membership', profileId: String(profileId) } }],
        start_date: startDate }, { idempotencyKey: `idoc-renewal-schedule-${profileId}-${preference.effectiveOn}` });
    } catch {
      await tx.update(renewalPreferences).set({ externalPaymentMethodId: paymentMethodId,
        externalRecurringPriceId: price.id, externalSetupIntentId: setupIntent.id,
        transitionState: 'failed', updatedAt: new Date() }).where(eq(renewalPreferences.profileId, profileId));
      await tx.insert(reconciliationFindings).values({ kind: 'pending_schedule_conflict', profileId,
        summary: 'Renewal authorization succeeded but Subscription Schedule creation failed.',
        details: { checkoutSessionId: session.id, priceId: price.id, setupIntentId: setupIntent.id } });
      return;
    }
    await tx.update(renewalPreferences).set({ expectedChargeCents: MEMBERSHIP_FEE_CENTS,
      externalPaymentMethodId: paymentMethodId, externalRecurringPriceId: price.id,
      externalSetupIntentId: setupIntent.id, externalSubscriptionScheduleId: schedule.id,
      transitionState: 'pending_activation', updatedAt: new Date() }).where(eq(renewalPreferences.profileId, profileId));
    await tx.insert(auditLog).values({ action: 'membership.renewal_change_authorized',
      afterJson: { effectiveOn: preference.effectiveOn, pendingMode: 'recurring' },
      entityId: String(profileId), entityType: 'renewal_preference' });
    return;
  }
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return;
  if (session.metadata?.kind === 'seminar_guest_registration') return handleGuestSeminarCheckoutSessionCompleted(tx, session, stripe);
  if (session.metadata?.kind === 'seminar_registration') return handleSeminarCheckoutSessionCompleted(tx, session, stripe);
  const profileId = Number(session.metadata?.profileId);
  if (!Number.isInteger(profileId)) return;
  const ownedProfileId = await resolveProfileId(tx, resolvedCustomerId(session.customer));
  if (ownedProfileId !== profileId) return;
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntentId) return;
  // docs/04 §3: grant entitlement only against the expected one-time fee, not whatever amount the
  // session happens to report — this is the "expected Price" check now that pricing is inline
  // price_data rather than a separately managed static Price ID.
  if (session.amount_total !== MEMBERSHIP_FEE_CENTS || session.currency?.toLowerCase() !== MEMBERSHIP_CURRENCY) return;
  // The amount/currency check above can't distinguish this session from any other Checkout Session
  // that happens to total the same €80 — confirm the line item was actually priced against the
  // configured one-time membership Product before granting entitlement.
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
  const price = lineItems.data[0]?.price;
  const productId = price ? (typeof price.product === 'string' ? price.product : price.product.id) : undefined;
  if (!price || productId !== stripeMembershipProductIdForServer()) return;
  const paidAt = new Date();
  const [inserted] = await tx.insert(payments).values({
    amountCents: session.amount_total,
    currency: session.currency.toUpperCase(),
    externalPaymentId: paymentIntentId,
    paidAt,
    profileId,
    reference: `checkout_session:${session.id};price:${price.id}`,
    source: 'stripe_one_time',
  }).onConflictDoNothing({ target: payments.externalPaymentId }).returning({ id: payments.id });
  if (!inserted) return;
  await tx.insert(renewalPreferences).values({ currentMode: 'non_recurring', profileId })
    .onConflictDoNothing({ target: renewalPreferences.profileId });
  const membership = await lockLatestMembership(tx, profileId);
  const validUntil = nextValidUntil({ currentValidUntil: membership?.validUntil ?? null, paidAt: paidAt.toISOString().slice(0, 10) });
  if (membership) {
    await tx.update(memberships).set({ graceEndsOn: null, status: 'active', updatedAt: new Date(), validUntil })
      .where(eq(memberships.id, membership.id));
  } else {
    await tx.insert(memberships).values({
      membershipType: 'standard', profileId, source: 'stripe',
      startsOn: paidAt.toISOString().slice(0, 10), status: 'active', validUntil,
    });
  }
}

// One-time payments are only ever initiated through Checkout in this design, so
// checkout.session.completed is the authoritative recorder (it carries the server-set profile
// metadata payment_intent.succeeded does not). This handler intentionally takes no action — it
// exists so the required event is acknowledged and its stripeEvents row recorded, satisfying
// docs/04 without double-crediting a payment checkout.session.completed already recorded.
async function handlePaymentIntentSucceeded(_tx: Transaction, _event: Stripe.Event, _stripe: WebhookStripeClient) {
  return undefined;
}

const handlers: Partial<Record<string, (tx: Transaction, event: Stripe.Event, stripe: WebhookStripeClient) => Promise<void>>> = {
  'charge.dispute.closed': handleDispute,
  'charge.dispute.created': handleDispute,
  'charge.refunded': handleChargeRefunded,
  'checkout.session.completed': handleCheckoutSessionCompleted,
  'customer.subscription.created': handleSubscriptionCreated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'invoice.paid': handleInvoicePaid,
  'invoice.payment_action_required': handleInvoicePaymentActionRequired,
  'invoice.payment_failed': handleInvoicePaymentFailed,
  'payment_intent.succeeded': handlePaymentIntentSucceeded,
  'refund.created': handleRefundEvent,
  'refund.failed': handleRefundEvent,
  'refund.updated': handleRefundEvent,
};

export async function processStripeEvent(event: Stripe.Event, stripe: WebhookStripeClient): Promise<'duplicate' | 'ignored' | 'processed'> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(stripeEvents).values({ eventType: event.type, externalEventId: event.id })
      .onConflictDoNothing({ target: stripeEvents.externalEventId }).returning({ id: stripeEvents.id });
    if (!inserted) return 'duplicate';
    const handler = handlers[event.type];
    if (handler) await handler(tx, event, stripe);
    await tx.update(stripeEvents).set({ processedAt: new Date() }).where(eq(stripeEvents.id, inserted.id));
    return handler ? 'processed' : 'ignored';
  });
}
