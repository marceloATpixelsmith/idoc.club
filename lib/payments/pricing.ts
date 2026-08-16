// Standard annual membership fee (docs/02 §2): flat €80, identical for every professional
// classification. Shared between Checkout Session creation and webhook verification so the two
// can never drift apart.
export const MEMBERSHIP_FEE_CENTS = 8000;
export const MEMBERSHIP_CURRENCY = 'eur';

// No 'server-only' import here (unlike lib/payments/manual-payments.ts) — this file is imported
// by the client-side manual-payment form as well as server code, so it must stay dependency-free.
export const MANUAL_PAYMENT_SOURCES = ['paypal', 'bank_transfer', 'cash', 'complimentary'] as const;
export type ManualPaymentSource = typeof MANUAL_PAYMENT_SOURCES[number];

// Statuses under which a subscription is still billing the member (docs/02 §5); a second
// subscription-mode checkout while one of these is open would double-bill. Lives here (not
// checkout.ts) so lib/membership/data-access.ts can import it without a circular dependency —
// checkout.ts already imports from data-access.ts.
export const OPEN_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const;

export const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer', cash: 'Cash / in person', complimentary: 'Complimentary',
  paypal: 'PayPal', stripe_one_time: 'Stripe (one-time)', stripe_recurring: 'Stripe (auto-renewal)',
};
