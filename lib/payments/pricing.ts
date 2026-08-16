// Standard annual membership fee (docs/02 §2): flat €80, identical for every professional
// classification. Shared between Checkout Session creation and webhook verification so the two
// can never drift apart.
export const MEMBERSHIP_FEE_CENTS = 8000;
export const MEMBERSHIP_CURRENCY = 'eur';
