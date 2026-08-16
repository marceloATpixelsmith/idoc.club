// Standard annual membership fee (docs/02 §2): flat €80, identical for every professional
// classification. Shared between Checkout Session creation and webhook verification so the two
// can never drift apart.
export const MEMBERSHIP_FEE_CENTS = 8000;
export const MEMBERSHIP_CURRENCY = 'eur';

// No 'server-only' import here (unlike lib/payments/manual-payments.ts) — this file is imported
// by the client-side manual-payment form as well as server code, so it must stay dependency-free.
export const MANUAL_PAYMENT_SOURCES = ['paypal', 'bank_transfer', 'cash', 'complimentary'] as const;
export type ManualPaymentSource = typeof MANUAL_PAYMENT_SOURCES[number];
