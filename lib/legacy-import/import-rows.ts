import type { PlannedMember, PlannedPayment } from './transform.ts';
import type { StripeSnapshot } from './stripe-reconcile.ts';

/**
 * Pure translation of the reviewed plan into the rows the temporary legacy import writes (docs/03 section 12). No database,
 * no Stripe calls and no randomness here, so the whole mapping is unit-tested. The database transaction lives in import-run.ts.
 *
 * TEMPORARY legacy-import support code: delete with the rest of lib/legacy-import once the migration is finished.
 */
const GRACE_DAYS = 5;
/** Stored in users.password_hash for imported accounts: it can never verify (not Argon2id, not bcrypt) until the first-login flow sets a real hash. */
export const UNVERIFIABLE_HASH_PLACEHOLDER = '!legacy-import-no-password-yet';
const STORED_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired']);

export interface ImportPaymentRow {
  legacyTransactionId: string;
  source: 'stripe_recurring' | 'stripe_one_time' | 'legacy_import';
  externalPaymentId: string | null;
  amountCents: number;
  paidAt: Date;
  reference: string | null;
  reason: string | null;
  refunded: boolean;
}
export interface ImportMemberRows {
  legacyUserId: string;
  user: { email: string; emailDisplay: string; passwordHash: string; accountState: 'migrated_pending'; role: 'member'; createdAt: Date; legacyPasswordHash: string | null; legacyPasswordFormat: 'phpass' | 'wp_bcrypt' | null };
  profile: { legacyWpUserId: number; firstName: string; lastName: string; address1: string; address2: string | null; city: string; stateProvince: string; postalCode: string; countryCode: string };
  roles: Array<{ roleType: string; nationalFederationCountryCode: string | null; idocRegion: string | null; feiId: string | null; officialStatuses: string[] | null; isTechnicalDelegate: boolean | null }>;
  membership: { status: 'active' | 'grace' | 'expired' | 'review_required'; startsOn: string; validUntil: string; graceEndsOn: string | null; membershipType: 'standard'; source: 'migration'; notes: string | null };
  billingCustomerId: string | null;
  subscription: { externalSubscriptionId: string; priceId: string; status: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean } | null;
  renewal: { currentMode: 'recurring' | 'non_recurring'; pendingMode: 'non_recurring' | null; effectiveOn: string | null; transitionState: 'current' | 'cancel_pending' };
  payments: ImportPaymentRow[];
  /** Counted for the run summary; none of these stop the import. */
  skipped: { zeroAmountPayments: number; unstorableSubscription: boolean };
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const clean = (value: string | null | undefined) => (value ?? '').trim();
const orNull = (value: string | null | undefined) => (clean(value) === '' ? null : clean(value));

function paymentRow(payment: PlannedPayment): ImportPaymentRow | null {
  if (payment.amountCents <= 0) return null;
  const stripe = payment.source === 'stripe' && payment.reference;
  return {
    legacyTransactionId: payment.legacyTransactionId,
    source: stripe ? (payment.recurring ? 'stripe_recurring' : 'stripe_one_time') : 'legacy_import',
    externalPaymentId: stripe ? payment.reference : null,
    amountCents: payment.amountCents,
    paidAt: new Date(`${payment.paidOn || '1970-01-01'}T00:00:00Z`),
    reference: stripe ? null : payment.reference,
    reason: stripe ? null : `Imported from MemberPress transaction ${payment.legacyTransactionId}; original payment method not recorded`,
    refunded: payment.outcome === 'refunded',
  };
}

/** Builds the rows for one importable member. `normalizeEmail`/`emailDisplayForm` are injected so this file stays free of app imports. */
export function buildMemberRows(
  member: PlannedMember,
  stripe: StripeSnapshot,
  forms: { normalizeEmail: (email: string) => string; emailDisplayForm: (email: string) => string },
): ImportMemberRows {
  const membership = member.membership;
  const supportedHash = member.hashFormat === 'phpass' || member.hashFormat === 'wp_bcrypt';
  const paymentRows = member.payments.map(paymentRow);
  const liveSubscription = member.stripe.subscriptionId ? stripe.subscriptions.find((sub) => sub.id === member.stripe.subscriptionId) ?? null : null;
  const storable = liveSubscription && STORED_SUBSCRIPTION_STATUSES.has(liveSubscription.status) && liveSubscription.priceId && liveSubscription.currentPeriodEnd ? liveSubscription : null;
  const recurringNow = storable !== null && ['active', 'trialing', 'past_due'].includes(storable.status);
  const cancelPending = recurringNow && storable.cancelAtPeriodEnd;
  const startsOn = membership.firstPaidOn ?? membership.lastPaidOn ?? member.registeredAt.slice(0, 10);
  const validUntil = membership.paidThrough ?? membership.lastPaidOn ?? startsOn;
  return {
    legacyUserId: member.legacyUserId,
    user: {
      email: forms.normalizeEmail(member.email),
      emailDisplay: forms.emailDisplayForm(member.emailDisplay || member.email),
      passwordHash: UNVERIFIABLE_HASH_PLACEHOLDER,
      accountState: 'migrated_pending',
      role: 'member',
      createdAt: new Date(`${member.registeredAt.slice(0, 10) || '1970-01-01'}T00:00:00Z`),
      legacyPasswordHash: supportedHash ? member.legacyPasswordHash : null,
      legacyPasswordFormat: supportedHash ? (member.hashFormat as 'phpass' | 'wp_bcrypt') : null,
    },
    profile: {
      legacyWpUserId: Number(member.legacyUserId),
      firstName: clean(member.profile.firstName), lastName: clean(member.profile.lastName),
      address1: clean(member.profile.address1), address2: orNull(member.profile.address2), city: clean(member.profile.city),
      stateProvince: clean(member.profile.stateProvince), postalCode: clean(member.profile.postalCode), countryCode: clean(member.profile.countryCode).toUpperCase(),
    },
    roles: member.roles.map((role) => ({
      roleType: role.roleType,
      nationalFederationCountryCode: orNull(role.nationalFederationCountryCode),
      idocRegion: orNull(role.idocRegion),
      feiId: orNull(role.feiId),
      officialStatuses: role.officialStatuses && role.officialStatuses.length > 0 ? role.officialStatuses : null,
      isTechnicalDelegate: role.isTechnicalDelegate ?? null,
    })),
    membership: {
      status: membership.status === 'unknown' ? 'review_required' : membership.status,
      startsOn, validUntil: validUntil < startsOn ? startsOn : validUntil,
      graceEndsOn: membership.status === 'grace' && membership.paidThrough ? addDays(membership.paidThrough, GRACE_DAYS) : null,
      // 'migration' is the source the account-activation foundation recognises (lib/membership/account-recovery.ts).
      membershipType: 'standard', source: 'migration',
      notes: membership.status === 'unknown' ? 'Legacy import: a completed payment has no expiry date; confirm the paid-through date.' : null,
    },
    billingCustomerId: orNull(member.stripe.customerId),
    subscription: storable ? { externalSubscriptionId: storable.id, priceId: storable.priceId, status: storable.status, currentPeriodEnd: storable.currentPeriodEnd, cancelAtPeriodEnd: storable.cancelAtPeriodEnd } : null,
    renewal: recurringNow
      ? { currentMode: 'recurring', pendingMode: cancelPending ? 'non_recurring' : null, effectiveOn: cancelPending ? storable.currentPeriodEnd : null, transitionState: cancelPending ? 'cancel_pending' : 'current' }
      : { currentMode: 'non_recurring', pendingMode: null, effectiveOn: null, transitionState: 'current' },
    payments: paymentRows.filter((row): row is ImportPaymentRow => row !== null),
    skipped: { zeroAmountPayments: paymentRows.filter((row) => row === null).length, unstorableSubscription: Boolean(member.stripe.subscriptionId) && storable === null },
  };
}
