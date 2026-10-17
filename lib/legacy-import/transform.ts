/**
 * Turns the parsed legacy WordPress/MemberPress tables into an import plan and an aggregate dry-run report, following
 * docs/03-legacy-data-migration-and-reconciliation-plan.md. Pure functions: no database, no network, no Stripe.
 *
 * Rules decided with the operator (2026-10): product -> roles (2042 Judge, 2053 Steward, 2787 Judge & Steward, 3038 Veterinarian);
 * "National Grand Prix Judge" -> "National Senior Officials / Candidates..."; steward "Level 3" -> "Level 3/4"; blank technical
 * delegate -> No; blank address country filled from the national federation; the newest active subscription is the live one.
 * Nothing is invented: anything else becomes a flagged exception for review.
 *
 * TEMPORARY legacy-import support code: delete with the rest of lib/legacy-import once the migration is finished.
 */
import { IDOC_REGIONS, ISO_COUNTRY_CODES, JUDGE_STATUSES, STEWARD_STATUSES, memberProfileSchema, normalizeEmail } from '../membership/validation.ts';
import type { DumpRow, ParsedDump } from './mysql-dump.ts';
import { checkedKeysFromPhpArray } from './php-serialized.ts';
import { legacyTableRole, type LegacyTableRole } from './reduce-dump.ts';

export interface ResolvedLegacyTables {
  tables: Partial<Record<LegacyTableRole, string>>;
  missing: LegacyTableRole[];
  /** Every table that was found for a role, with its row count. The largest is used; the others are listed so nothing is hidden. */
  found: Array<{ role: LegacyTableRole; table: string; rows: number; used: boolean }>;
}

/** Picks, for each role (users, usermeta, MemberPress transactions and subscriptions), the matching table with the most rows. */
export function resolveLegacyTables(dump: ParsedDump): ResolvedLegacyTables {
  const found: ResolvedLegacyTables['found'] = [];
  const tables: ResolvedLegacyTables['tables'] = {};
  for (const role of ['users', 'usermeta', 'transactions', 'subscriptions'] as const) {
    const candidates = [...dump.entries()].filter(([table]) => legacyTableRole(table) === role).sort(([a, rowsA], [b, rowsB]) => rowsB.length - rowsA.length || a.localeCompare(b));
    candidates.forEach(([table, rows], index) => found.push({ role, table, rows: rows.length, used: index === 0 }));
    if (candidates.length > 0) tables[role] = candidates[0][0];
  }
  return { tables, found, missing: (['users', 'usermeta', 'transactions', 'subscriptions'] as const).filter((role) => !tables[role]) };
}
type Classification = 'judge' | 'steward' | 'judge_steward' | 'veterinarian';
const PRODUCT_CLASSIFICATION: Record<string, Classification> = {
  '2042': 'judge', '2053': 'steward', '2787': 'judge_steward', '3038': 'veterinarian',
};

type JudgeStatus = (typeof JUDGE_STATUSES)[number];
type StewardStatus = (typeof STEWARD_STATUSES)[number];
type Region = (typeof IDOC_REGIONS)[number];

const JUDGE_STATUS_MAP: Record<string, JudgeStatus> = {
  'fei-dressage-judge-1-2': 'FEI Dressage Judge 1/2**',
  'fei-dressage-judge-2-3': 'FEI Dressage Judge 2/3*',
  'fei-dressage-judge-3-4': 'FEI Dressage Judge 3/4*',
  'fei-dressage-judge-4-5': 'FEI Dressage Judge 4/5**',
  'national-grand-prix-judge': 'National Senior Officials / Candidates from EEFs education system FEI',
  'fei-para-dressage-judge': 'Para Dressage Judge',
  'retired-official': 'Retired Official',
  other: 'Other',
};
const STEWARD_STATUS_MAP: Record<string, StewardStatus> = {
  'fei-dressage-steward-level-1': 'FEI Dressage Steward Level 1',
  'fei-dressage-steward-level-2': 'FEI Dressage Steward Level 2',
  'fei-dressage-steward-level-3-4': 'FEI Dressage Steward Level 3/4',
  'fei-dressage-steward-level-3': 'FEI Dressage Steward Level 3/4',
  'national-dressage-steward': 'National Dressage Steward',
  'fei-para-dressage-steward': 'FEI Para Dressage Steward',
  other: 'Other',
};
const REGION_MAP: Record<string, Region> = {
  'western-europe-africa': 'Western Europe & Africa',
  'central-eastern-europe': 'Central & Eastern Europe',
  asia: 'Asia',
  'north-america': 'North America',
  'central-latin-america': 'Central & Latin America',
  pacific: 'Pacific',
};
const COUNTRIES: ReadonlySet<string> = new Set(ISO_COUNTRY_CODES);
const GRACE_DAYS = 5;

export type ExceptionCode =
  | 'user_flagged_deleted_or_spam' | 'invalid_email' | 'duplicate_email' | 'unsupported_password_hash'
  | 'no_membership_product' | 'product_profile_mismatch' | 'unmapped_legacy_value' | 'incomplete_profile'
  | 'blank_expiry_on_paid_transaction' | 'multiple_active_subscriptions'
  | 'active_subscription_not_newest' | 'invalid_subscription_reference' | 'invalid_stripe_customer_id'
  | 'multiple_stripe_customers' | 'active_subscription_without_stripe_customer' | 'duplicate_payment_reference' | 'duplicate_payment_reference_same_member';

export type NoteCode = 'country_filled_from_federation' | 'technical_delegate_defaulted_no' | 'product_changed_over_time' | 'duplicate_payment_row_removed';
export type ExclusionCode = 'expired_over_a_year' | 'never_paid';

/** "expected": the plan already has a remedy, nothing to decide. "review": a person has to look at it and decide. */
export type IssueKind = 'expected' | 'review';
export interface IssueInfo { text: string; kind: IssueKind; remedy: string | null; held: boolean }

export const EXCLUSION_INFO: Record<ExclusionCode, string> = {
  expired_over_a_year: 'Expired for a year or more: not imported (they can sign up again)',
  never_paid: 'No completed payment on record: not imported (they can sign up again)',
};

export const ISSUE_INFO: Record<ExceptionCode | NoteCode, IssueInfo> = {
  incomplete_profile: { text: 'Required profile fields are missing', kind: 'expected', remedy: 'Imported, then required to complete the missing fields in onboarding at first sign-in', held: false },
  unsupported_password_hash: { text: 'Password hash is not a supported WordPress format', kind: 'expected', remedy: 'Uses the one-time secure activation / password-set flow', held: false },
  country_filled_from_federation: { text: 'Address country was blank and was filled from the national federation country', kind: 'expected', remedy: 'Filled automatically; the member confirms it in onboarding', held: false },
  technical_delegate_defaulted_no: { text: 'Technical delegate answer was blank and defaulted to No', kind: 'expected', remedy: 'Defaulted automatically; the member can change it', held: false },
  duplicate_payment_row_removed: { text: 'The same payment (same Stripe reference, amount and outcome) appears twice on this member', kind: 'expected', remedy: 'Imported once; the duplicated row is dropped', held: false },
  product_changed_over_time: { text: 'The member has paid under more than one membership product over time', kind: 'expected', remedy: 'The most recent product decides the roles', held: false },
  user_flagged_deleted_or_spam: { text: 'WordPress marks the user deleted or spam', kind: 'review', remedy: null, held: true },
  invalid_email: { text: 'Email address is missing or not valid', kind: 'review', remedy: null, held: true },
  duplicate_email: { text: 'Same email as another legacy user (merge or keep separate?)', kind: 'review', remedy: null, held: true },
  no_membership_product: { text: 'No payment or subscription names a membership product, so the roles are unknown', kind: 'review', remedy: null, held: false },
  product_profile_mismatch: { text: 'Membership product disagrees with the judge/steward details on the profile', kind: 'review', remedy: null, held: false },
  unmapped_legacy_value: { text: 'A judge/steward status, region or federation value has no approved mapping', kind: 'review', remedy: null, held: false },
  blank_expiry_on_paid_transaction: { text: 'A completed payment has no expiry date (lifetime or blank)', kind: 'review', remedy: null, held: false },
  multiple_active_subscriptions: { text: 'More than one active subscription: possible double billing, check Stripe', kind: 'review', remedy: null, held: false },
  active_subscription_not_newest: { text: 'The active subscription is not the newest one', kind: 'review', remedy: null, held: false },
  invalid_subscription_reference: { text: 'Active subscription has no valid Stripe subscription ID (sub_...)', kind: 'review', remedy: null, held: false },
  invalid_stripe_customer_id: { text: 'Stored Stripe customer ID does not look like cus_...', kind: 'review', remedy: null, held: false },
  multiple_stripe_customers: { text: 'More than one different Stripe customer ID stored for the member', kind: 'review', remedy: null, held: false },
  active_subscription_without_stripe_customer: { text: 'Active subscription but no stored Stripe customer ID', kind: 'review', remedy: null, held: false },
  duplicate_payment_reference: { text: 'The same Stripe payment reference appears on transactions of DIFFERENT members', kind: 'review', remedy: null, held: false },
  duplicate_payment_reference_same_member: { text: 'The same Stripe payment reference appears on the SAME member with a different amount or outcome (cannot tell which row is right)', kind: 'review', remedy: null, held: false },
};

export interface PlannedRole {
  roleType: 'judge' | 'steward' | 'veterinarian';
  nationalFederationCountryCode?: string;
  idocRegion?: string;
  feiId?: string | null;
  officialStatuses?: string[];
  isTechnicalDelegate?: boolean;
}
export interface PlannedPayment {
  legacyTransactionId: string;
  reference: string | null;
  source: 'stripe' | 'manual';
  amountCents: number;
  paidOn: string;
  expiresOn: string | null;
  outcome: 'paid' | 'refunded';
}
export interface PlannedMember {
  legacyUserId: string;
  held: boolean;
  email: string;
  legacyPasswordHash: string;
  hashFormat: 'phpass' | 'wp_bcrypt' | 'unsupported';
  registeredAt: string;
  profile: { firstName: string; lastName: string; address1: string; address2: string; city: string; stateProvince: string; postalCode: string; countryCode: string };
  classification: Classification | null;
  roles: PlannedRole[];
  missingFields: string[];
  membership: { status: 'active' | 'grace' | 'expired' | 'unknown'; paidThrough: string | null; firstPaidOn: string | null; lastPaidOn: string | null };
  /** Set when a cleanup rule removes the member from the import and from every report figure. */
  exclusion: ExclusionCode | null;
  subscriptionStatuses: string[];
  stripe: { customerId: string | null; subscriptionId: string | null };
  payments: PlannedPayment[];
  ignoredPayments: number;
  exceptions: ExceptionCode[];
  notes: NoteCode[];
}
export interface LegacyImportPlan {
  asOf: string;
  members: PlannedMember[];
  orphanPaymentUserIds: string[];
  orphanSubscriptionUserIds: string[];
  /** Payments or subscriptions whose user has no account row. */
  sourceTables: ResolvedLegacyTables['found'];
  orphans: Array<{ legacyUserId: string; paymentCount: number; lastPaidOn: string | null; paidThrough: string | null; hasActiveSubscription: boolean; subscriptionStatuses: string[] }>;
}

const text = (value: string | null | undefined) => (value ?? '').trim();
/** The application's own canonical email rules; anything it would reject is not importable. Empty string means invalid. */
function canonicalEmail(value: string | null | undefined): string {
  try { return normalizeEmail(text(value)); } catch { return ''; }
}
const isoDay = (value: string | null | undefined): string | null => {
  const day = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !day.startsWith('0000') ? day : null;
};
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** The same calendar date one year earlier (29 February falls back to 28 February). */
function yearBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = grouped.get(k);
    if (list) list.push(row); else grouped.set(k, [row]);
  }
  return grouped;
}
const byCreated = (a: DumpRow, b: DumpRow) => text(a.created_at).localeCompare(text(b.created_at)) || Number(a.id) - Number(b.id);

function hashFormat(hash: string): PlannedMember['hashFormat'] {
  if (hash.startsWith('$P$')) return 'phpass';
  if (hash.startsWith('$wp$2y$')) return 'wp_bcrypt';
  return 'unsupported';
}

function missingFieldNames(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>, roles: PlannedRole[]): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    const [head, index, field] = issue.path;
    if (head === 'roles' && typeof index === 'number' && field !== undefined) names.add(`${roles[index]?.roleType ?? 'role'}.${String(field)}`);
    else names.add(String(head));
  }
  return [...names].sort();
}

export function planLegacyImport(dump: ParsedDump, options: { asOf: string }): LegacyImportPlan {
  const resolved = resolveLegacyTables(dump);
  if (resolved.missing.length > 0) throw new Error(`Missing legacy tables: ${resolved.missing.join(', ')}`);
  const users = dump.get(resolved.tables.users!) ?? [];
  const metaRows = dump.get(resolved.tables.usermeta!) ?? [];
  const transactions = dump.get(resolved.tables.transactions!) ?? [];
  const subscriptions = dump.get(resolved.tables.subscriptions!) ?? [];

  const metaByUser = new Map<string, Map<string, string | null>>();
  const stripeCustomersByUser = new Map<string, string[]>();
  for (const row of metaRows) {
    const userId = text(row.user_id);
    const key = text(row.meta_key);
    let meta = metaByUser.get(userId);
    if (!meta) { meta = new Map(); metaByUser.set(userId, meta); }
    meta.set(key, row.meta_value);
    if (key.startsWith('_mepr_stripe_customer_id_') && text(row.meta_value)) {
      const list = stripeCustomersByUser.get(userId) ?? [];
      list.push(text(row.meta_value));
      stripeCustomersByUser.set(userId, list);
    }
  }
  const txByUser = groupBy(transactions, (row) => text(row.user_id));
  const subsByUser = groupBy(subscriptions, (row) => text(row.user_id));
  const userIds = new Set(users.map((user) => text(user.ID)));

  const members: PlannedMember[] = users.map((user) => {
    const legacyUserId = text(user.ID);
    const exceptions = new Set<ExceptionCode>();
    const notes = new Set<NoteCode>();
    const meta = metaByUser.get(legacyUserId) ?? new Map<string, string | null>();
    const metaText = (key: string) => text(meta.get(key));

    const email = canonicalEmail(user.user_email);
    if (text(user.deleted) !== '0' && text(user.deleted) !== '' || text(user.spam) !== '0' && text(user.spam) !== '') exceptions.add('user_flagged_deleted_or_spam');
    if (!email) exceptions.add('invalid_email');
    const legacyPasswordHash = text(user.user_pass);
    const format = hashFormat(legacyPasswordHash);
    if (format === 'unsupported') exceptions.add('unsupported_password_hash');

    // Payments: only completed (or refunded) "payment" transactions count; failed and pending ones never extend a date.
    const userTx = (txByUser.get(legacyUserId) ?? []).slice().sort(byCreated);
    const payments: PlannedPayment[] = [];
    let ignoredPayments = 0;
    for (const tx of userTx) {
      if (text(tx.txn_type) !== 'payment') continue;
      const status = text(tx.status);
      if (status !== 'complete' && status !== 'refunded') { ignoredPayments++; continue; }
      const reference = text(tx.trans_num) || null;
      const manual = !reference || reference.startsWith('mp-') || text(tx.gateway) === 'manual';
      const amount = Math.round(Number(text(tx.total) || text(tx.amount) || '0') * 100);
      const duplicate = reference && !manual && payments.some((earlier) => earlier.reference === reference && earlier.amountCents === (Number.isFinite(amount) ? amount : 0) && earlier.outcome === (status === 'refunded' ? 'refunded' : 'paid'));
      if (duplicate) { notes.add('duplicate_payment_row_removed'); continue; }
      payments.push({
        legacyTransactionId: text(tx.id), reference, source: manual ? 'manual' : 'stripe', amountCents: Number.isFinite(amount) ? amount : 0,
        paidOn: isoDay(tx.created_at) ?? '', expiresOn: isoDay(tx.expires_at), outcome: status === 'refunded' ? 'refunded' : 'paid',
      });
    }
    const paid = payments.filter((payment) => payment.outcome === 'paid');
    if (paid.some((payment) => payment.expiresOn === null)) exceptions.add('blank_expiry_on_paid_transaction');
    const paidThrough = paid.map((payment) => payment.expiresOn).filter((day): day is string => day !== null).sort().pop() ?? null;
    const firstPaidOn = paid.map((payment) => payment.paidOn).filter(Boolean).sort()[0] ?? null;
    const lastPaidOn = paid.map((payment) => payment.paidOn).filter(Boolean).sort().pop() ?? null;
    let membershipStatus: PlannedMember['membership']['status'] = 'unknown';
    if (paidThrough) membershipStatus = paidThrough >= options.asOf ? 'active' : addDays(paidThrough, GRACE_DAYS) >= options.asOf ? 'grace' : 'expired';
    // Cleanup rules: nobody with no completed payment, or expired for a year or more, is imported or counted.
    const exclusion: ExclusionCode | null = paid.length === 0 ? 'never_paid'
      : paidThrough !== null && paidThrough <= yearBefore(options.asOf) ? 'expired_over_a_year' : null;

    // Subscriptions: the newest active one is the live one; anything else is history.
    const userSubs = (subsByUser.get(legacyUserId) ?? []).slice().sort(byCreated);
    const activeSubs = userSubs.filter((sub) => text(sub.status) === 'active');
    let subscriptionId: string | null = null;
    if (activeSubs.length > 1) exceptions.add('multiple_active_subscriptions');
    else if (activeSubs.length === 1) {
      if (activeSubs[0] !== userSubs[userSubs.length - 1]) exceptions.add('active_subscription_not_newest');
      const reference = text(activeSubs[0].subscr_id);
      if (reference.startsWith('sub_')) subscriptionId = reference; else exceptions.add('invalid_subscription_reference');
    }
    const customers = [...new Set(stripeCustomersByUser.get(legacyUserId) ?? [])];
    if (customers.length > 1) exceptions.add('multiple_stripe_customers');
    const customerId = customers.length === 1 ? customers[0] : null;
    if (customerId && !customerId.startsWith('cus_')) exceptions.add('invalid_stripe_customer_id');
    if (activeSubs.length === 1 && !customerId) exceptions.add('active_subscription_without_stripe_customer');

    // Product -> roles. The latest completed payment's product wins; a subscription's product is the fallback.
    const productSources = [...paid.length ? userTx.filter((tx) => text(tx.txn_type) === 'payment' && text(tx.status) === 'complete') : [], ...userSubs];
    const products = [...new Set(productSources.map((row) => text(row.product_id)).filter(Boolean))];
    if (products.length > 1) notes.add('product_changed_over_time');
    const latestProduct = text((productSources.filter((row) => text(row.product_id)).slice(-1)[0] ?? {}).product_id);
    const paidTx = userTx.filter((tx) => text(tx.txn_type) === 'payment' && text(tx.status) === 'complete');
    const productId = text((paidTx[paidTx.length - 1] ?? {}).product_id) || latestProduct;
    const classification = PRODUCT_CLASSIFICATION[productId] ?? null;
    if (!classification) exceptions.add('no_membership_product');

    // Profile and role details from usermeta.
    const federationRaw = metaText('mepr_national_federation').toUpperCase();
    const federation = COUNTRIES.has(federationRaw) ? federationRaw : '';
    if (federationRaw && !federation) exceptions.add('unmapped_legacy_value');
    const regionSlug = metaText('mepr_idoc_region');
    const region = REGION_MAP[regionSlug];
    if (regionSlug && !region) exceptions.add('unmapped_legacy_value');
    const judgeKeys = checkedKeysFromPhpArray(meta.get('mepr_official_status_as_judge')) ?? [];
    const stewardKeys = checkedKeysFromPhpArray(meta.get('mepr_official_status_as_steward')) ?? [];
    const judgeStatuses = judgeKeys.map((key) => JUDGE_STATUS_MAP[key]);
    const stewardStatuses = stewardKeys.map((key) => STEWARD_STATUS_MAP[key]);
    if (judgeStatuses.some((status) => status === undefined) || stewardStatuses.some((status) => status === undefined)) exceptions.add('unmapped_legacy_value');
    const knownJudge = judgeStatuses.filter((status): status is JudgeStatus => status !== undefined);
    const knownSteward = stewardStatuses.filter((status): status is StewardStatus => status !== undefined);
    const technicalDelegateRaw = metaText('mepr_are_you_a_technical_delegate').toLowerCase();
    if (!technicalDelegateRaw) notes.add('technical_delegate_defaulted_no');
    const feiId = metaText('mepr_fei_number') || null;

    const roles: PlannedRole[] = [];
    const official = { nationalFederationCountryCode: federation, idocRegion: region ?? '', feiId };
    if (classification === 'judge' || classification === 'judge_steward') {
      roles.push({ roleType: 'judge', ...official, officialStatuses: knownJudge, isTechnicalDelegate: technicalDelegateRaw === 'yes' });
    }
    if (classification === 'steward' || classification === 'judge_steward') roles.push({ roleType: 'steward', ...official, officialStatuses: knownSteward });
    if (classification === 'veterinarian') roles.push({ roleType: 'veterinarian' });
    if ((classification === 'judge' && knownSteward.length > 0) || (classification === 'steward' && knownJudge.length > 0)
      || (classification === 'veterinarian' && (knownJudge.length > 0 || knownSteward.length > 0))) exceptions.add('product_profile_mismatch');

    let countryCode = metaText('mepr-address-country').toUpperCase();
    if (!COUNTRIES.has(countryCode)) countryCode = '';
    if (!countryCode && federation) { countryCode = federation; notes.add('country_filled_from_federation'); }
    const profile = {
      firstName: metaText('first_name'), lastName: metaText('last_name'), address1: metaText('mepr-address-one'), address2: metaText('mepr-address-two'),
      city: metaText('mepr-address-city'), stateProvince: metaText('mepr-address-state'), postalCode: metaText('mepr-address-zip'), countryCode,
    };
    const check = memberProfileSchema.safeParse({ ...profile, roles });
    const missingFields = check.success ? [] : missingFieldNames(check.error.issues, roles);
    if (missingFields.length > 0) exceptions.add('incomplete_profile');

    const held = exceptions.has('user_flagged_deleted_or_spam') || exceptions.has('invalid_email') || exceptions.has('duplicate_email');
    return {
      legacyUserId, held, email, legacyPasswordHash, hashFormat: format, registeredAt: text(user.user_registered), profile, classification, roles, missingFields,
      membership: { status: membershipStatus, paidThrough, firstPaidOn, lastPaidOn }, exclusion, subscriptionStatuses: userSubs.map((sub) => text(sub.status) || '(blank)'),
      stripe: { customerId, subscriptionId }, payments, ignoredPayments,
      exceptions: [...exceptions].sort(), notes: [...notes].sort(),
    };
  });

  const inScope = members.filter((member) => !member.exclusion);
  // Duplicate emails are judged only among members who stay in scope.
  const emailCounts = new Map<string, number>();
  for (const member of inScope) if (member.email) emailCounts.set(member.email, (emailCounts.get(member.email) ?? 0) + 1);
  for (const member of inScope) {
    if (member.email && (emailCounts.get(member.email) ?? 0) > 1) {
      member.exceptions = [...new Set<ExceptionCode>([...member.exceptions, 'duplicate_email'])].sort();
      member.held = true;
    }
  }
  // A Stripe payment reference must belong to exactly one transaction; otherwise importing it would violate the unique reference.
  const referenceOwners = new Map<string, Set<string>>();
  for (const member of inScope) {
    for (const payment of member.payments) {
      if (payment.source !== 'stripe' || !payment.reference) continue;
      const owners = referenceOwners.get(payment.reference) ?? new Set<string>();
      owners.add(`${member.legacyUserId}:${payment.legacyTransactionId}`);
      referenceOwners.set(payment.reference, owners);
    }
  }
  const crossMemberOwners = new Set<string>();
  const sameMemberOwners = new Set<string>();
  for (const owners of referenceOwners.values()) {
    if (owners.size < 2) continue;
    const perMember = new Map<string, number>();
    for (const owner of owners) perMember.set(owner.split(':')[0], (perMember.get(owner.split(':')[0]) ?? 0) + 1);
    for (const [memberId, count] of perMember) {
      if (perMember.size > 1) crossMemberOwners.add(memberId);
      if (count > 1) sameMemberOwners.add(memberId);
    }
  }
  for (const member of inScope) {
    const extra: ExceptionCode[] = [];
    if (crossMemberOwners.has(member.legacyUserId)) extra.push('duplicate_payment_reference');
    if (sameMemberOwners.has(member.legacyUserId)) extra.push('duplicate_payment_reference_same_member');
    if (extra.length > 0) member.exceptions = [...new Set<ExceptionCode>([...member.exceptions, ...extra])].sort();
  }

  const orphanPaymentUserIds = [...new Set(transactions.map((row) => text(row.user_id)).filter((id) => !userIds.has(id)))].sort((a, b) => Number(a) - Number(b));
  const orphanSubscriptionUserIds = [...new Set(subscriptions.map((row) => text(row.user_id)).filter((id) => !userIds.has(id)))].sort((a, b) => Number(a) - Number(b));
  const orphans = [...new Set([...orphanPaymentUserIds, ...orphanSubscriptionUserIds])].sort((a, b) => Number(a) - Number(b)).map((legacyUserId) => {
    const paidRows = (txByUser.get(legacyUserId) ?? []).filter((tx) => text(tx.txn_type) === 'payment' && text(tx.status) === 'complete');
    const orphanSubs = (subsByUser.get(legacyUserId) ?? []).slice().sort(byCreated);
    const paidThrough = paidRows.map((tx) => isoDay(tx.expires_at)).filter((day): day is string => day !== null).sort().pop() ?? null;
    const hasActiveSubscription = orphanSubs.some((sub) => text(sub.status) === 'active');
    return {
      legacyUserId, paymentCount: paidRows.length,
      lastPaidOn: paidRows.map((tx) => isoDay(tx.created_at)).filter((day): day is string => day !== null).sort().pop() ?? null,
      paidThrough, hasActiveSubscription, subscriptionStatuses: orphanSubs.map((sub) => text(sub.status) || '(blank)'),
    };
  });
  return { asOf: options.asOf, members, orphanPaymentUserIds, orphanSubscriptionUserIds, orphans, sourceTables: resolved.found };
}


// ---------------------------------------------------------------------------------------------------------------------
// Report. Aggregate figures cover only members who stay in scope (the two cleanup rules remove everyone else from every figure).
// Each group also carries one row per person, for the operator's CSV download. Rows never include password hashes.
// ---------------------------------------------------------------------------------------------------------------------

export type ReportRow = Record<string, string>;
export interface ReportGroup {
  key: string;
  text: string;
  kind: IssueKind | 'excluded';
  remedy: string | null;
  held: boolean;
  count: number;
  columns: string[];
  rows: ReportRow[];
}
export interface DryRunReport {
  asOf: string;
  sourceTables: ResolvedLegacyTables['found'];
  legacyUsers: number;
  removedByRules: number;
  inScope: number;
  held: number;
  importable: number;
  excluded: ReportGroup[];
  hashFormats: Record<string, number>;
  classification: Record<string, number>;
  membershipStatus: Record<string, number>;
  profile: { complete: number; needsOnboarding: number; missingFields: Record<string, number> };
  stripe: { withCustomerId: number; withActiveSubscription: number; activeSubscriptionWithoutCustomer: number; customerWithoutActiveSubscription: number };
  subscriptionsByStatus: Record<string, number>;
  payments: { paid: number; refunded: number; stripe: number; manual: number; ignoredFailedOrPending: number };
  expected: ReportGroup[];
  review: ReportGroup[];
  /** Filled in by the server after the comparison with live Stripe; absent until then. */
  stripeReconciliation?: import('./stripe-reconcile.ts').StripeReconciliation;
}

export const MEMBER_COLUMNS = [
  'legacy_user_id', 'email', 'first_name', 'last_name', 'registered', 'membership_product', 'membership_status', 'paid_through', 'first_paid_on', 'last_paid_on',
  'completed_payments', 'subscription_statuses', 'active_subscription_id', 'stripe_customer_id', 'country', 'national_federation', 'idoc_region', 'missing_fields', 'issues', 'notes',
];
const ORPHAN_COLUMNS = ['legacy_user_id', 'completed_payments', 'last_paid_on', 'paid_through', 'subscription_statuses', 'has_active_subscription'];

function memberRow(member: PlannedMember): ReportRow {
  const official = member.roles.find((role) => role.roleType !== 'veterinarian');
  return {
    legacy_user_id: member.legacyUserId, email: member.email, first_name: member.profile.firstName, last_name: member.profile.lastName,
    registered: member.registeredAt.slice(0, 10), membership_product: member.classification ?? '', membership_status: member.membership.status,
    paid_through: member.membership.paidThrough ?? '', first_paid_on: member.membership.firstPaidOn ?? '', last_paid_on: member.membership.lastPaidOn ?? '',
    completed_payments: String(member.payments.filter((payment) => payment.outcome === 'paid').length), subscription_statuses: member.subscriptionStatuses.join(' > '),
    active_subscription_id: member.stripe.subscriptionId ?? '', stripe_customer_id: member.stripe.customerId ?? '', country: member.profile.countryCode,
    national_federation: official?.nationalFederationCountryCode ?? '', idoc_region: official?.idocRegion ?? '', missing_fields: member.missingFields.join('; '),
    issues: member.exceptions.join('; '), notes: member.notes.join('; '),
  };
}

function tally<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function group(key: string, info: { text: string; kind: IssueKind | 'excluded'; remedy: string | null; held: boolean }, members: PlannedMember[]): ReportGroup {
  return { key, ...info, count: members.length, columns: MEMBER_COLUMNS, rows: members.map(memberRow) };
}

/** Aggregate figures for the operator, plus one row per person behind every group. No password hashes or payment references. */
export function summarizePlan(plan: LegacyImportPlan): DryRunReport {
  const inScope = plan.members.filter((member) => !member.exclusion);
  const importable = inScope.filter((member) => !member.held);
  const allPayments = importable.flatMap((member) => member.payments);
  const issues = (code: ExceptionCode | NoteCode, kind: 'exceptions' | 'notes') => inScope.filter((member) => (kind === 'exceptions' ? member.exceptions : member.notes).includes(code as never));

  const groups: ReportGroup[] = [];
  for (const [code, info] of Object.entries(ISSUE_INFO) as Array<[ExceptionCode | NoteCode, IssueInfo]>) {
    const members = [...issues(code, 'exceptions'), ...issues(code, 'notes')];
    if (members.length > 0) groups.push(group(code, info, members));
  }
  const orphanGroup = (key: string, text: string, kind: ReportGroup['kind'], orphans: LegacyImportPlan['orphans'], remedy: string | null): ReportGroup => ({
    key, text, kind, remedy, held: false, count: orphans.length, columns: ORPHAN_COLUMNS,
    rows: orphans.map((orphan) => ({
      legacy_user_id: orphan.legacyUserId, completed_payments: String(orphan.paymentCount), last_paid_on: orphan.lastPaidOn ?? '', paid_through: orphan.paidThrough ?? '',
      subscription_statuses: orphan.subscriptionStatuses.join(' > '), has_active_subscription: orphan.hasActiveSubscription ? 'yes' : 'no',
    })),
  });
  // A payment or subscription whose user has no account row means the person was deliberately deleted: not a member, nothing is imported.
  if (plan.orphans.length > 0) {
    const stillActive = plan.orphans.filter((orphan) => orphan.hasActiveSubscription).length;
    groups.push(orphanGroup(
      'no_account_record',
      'Payment or subscription history for a user with no account record (deleted people, not members)',
      'expected',
      plan.orphans,
      `Nothing is imported; their payment and subscription history is left out.${stillActive > 0 ? ` ${stillActive} still show an active subscription in MemberPress: the download has a column for it, so check those in Stripe.` : ''}`,
    ));
  }
  const bySize = (a: ReportGroup, b: ReportGroup) => Number(b.held) - Number(a.held) || b.count - a.count || a.key.localeCompare(b.key);
  const excluded = (Object.keys(EXCLUSION_INFO) as ExclusionCode[]).map((code) => group(code, { text: EXCLUSION_INFO[code], kind: 'excluded', remedy: null, held: false }, plan.members.filter((member) => member.exclusion === code)));

  return {
    asOf: plan.asOf,
    sourceTables: plan.sourceTables,
    legacyUsers: plan.members.length,
    removedByRules: plan.members.length - inScope.length,
    inScope: inScope.length,
    held: inScope.length - importable.length,
    importable: importable.length,
    excluded,
    hashFormats: tally(inScope, (member) => member.hashFormat),
    classification: tally(importable, (member) => member.classification ?? 'unknown'),
    membershipStatus: tally(importable, (member) => member.membership.status),
    profile: {
      complete: importable.filter((member) => member.missingFields.length === 0).length,
      needsOnboarding: importable.filter((member) => member.missingFields.length > 0).length,
      missingFields: tally(importable.flatMap((member) => member.missingFields), (field) => field),
    },
    stripe: {
      withCustomerId: importable.filter((member) => member.stripe.customerId).length,
      withActiveSubscription: importable.filter((member) => member.stripe.subscriptionId).length,
      activeSubscriptionWithoutCustomer: importable.filter((member) => member.stripe.subscriptionId && !member.stripe.customerId).length,
      customerWithoutActiveSubscription: importable.filter((member) => member.stripe.customerId && !member.stripe.subscriptionId).length,
    },
    subscriptionsByStatus: tally(importable.flatMap((member) => member.subscriptionStatuses), (status) => status),
    payments: {
      paid: allPayments.filter((payment) => payment.outcome === 'paid').length,
      refunded: allPayments.filter((payment) => payment.outcome === 'refunded').length,
      stripe: allPayments.filter((payment) => payment.source === 'stripe').length,
      manual: allPayments.filter((payment) => payment.source === 'manual').length,
      ignoredFailedOrPending: importable.reduce((sum, member) => sum + member.ignoredPayments, 0),
    },
    expected: groups.filter((item) => item.kind === 'expected').sort(bySize),
    review: groups.filter((item) => item.kind === 'review').sort(bySize),
  };
}
