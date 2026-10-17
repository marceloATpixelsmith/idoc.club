import Stripe from 'stripe';

import type { LegacyImportPlan, PlannedMember, ReportGroup, ReportRow } from './transform.ts';

/**
 * Read-only comparison of the legacy subscriptions and payments with LIVE Stripe, for the temporary legacy import report.
 * It uses its own restricted key (`LEGACY_STRIPE_SECRET_KEY`, live mode only) and only ever calls list endpoints; it never uses
 * the application's Stripe key and never creates, changes or cancels anything. Output holds Stripe IDs, names, emails and
 * statuses for the Super Admin, never card data or legacy payment references.
 *
 * TEMPORARY legacy-import support code: delete with the rest of lib/legacy-import once the migration is finished.
 */
export interface StripeSnapshot {
  subscriptions: Array<{ id: string; customerId: string; status: string; email: string; priceId: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean }>;
  customerIds: Set<string>;
  chargeRefs: Set<string>;
  /** True when a list was cut short; each list reports its own truncation so only the checks that depend on it are skipped. */
  truncated: { subscriptions: boolean; customers: boolean; charges: boolean };
}

export interface StripeReconciliation {
  state: 'not_configured' | 'unusable_key' | 'error' | 'ok';
  message: string | null;
  partial: boolean;
  /** Checks that could not run because a Stripe list was cut short; shown so an empty result is never read as "all clear". */
  skipped: string[];
  fetched: { subscriptions: number; customers: number; charges: number };
  groups: ReportGroup[];
  /** What live Stripe says about the subscriptions of people who are not being imported (deleted users and removed members). `undetermined` when the subscription list was cut short. */
  removedPeople: { checked: number; live: number; cancelled: number; notFound: number; undetermined: boolean };
}

const MAX_ITEMS_PER_LIST = 50_000;
const TIME_BUDGET_MS = 45_000;
const CHARGE_CONCURRENCY = 8;
const LIVE_SUBSCRIPTION = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused']);
const DEAD_SUBSCRIPTION = new Set(['canceled', 'incomplete_expired']);

export function legacyStripeKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.LEGACY_STRIPE_SECRET_KEY?.trim();
  return key ? key : null;
}

/** Month windows (UTC, as unix seconds) from `since` to `until`, so the charge list can be read in parallel instead of one long page-by-page walk. */
export function monthWindows(since: Date, until: Date): Array<{ gte: number; lt: number }> {
  const windows: Array<{ gte: number; lt: number }> = [];
  let start = Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1);
  while (start <= until.getTime()) {
    const next = new Date(start);
    next.setUTCMonth(next.getUTCMonth() + 1);
    windows.push({ gte: start / 1000, lt: next.getTime() / 1000 });
    start = next.getTime();
  }
  return windows;
}

export async function fetchStripeSnapshot(key: string, since: Date, now: () => number = Date.now): Promise<StripeSnapshot> {
  const stripe = new Stripe(key, { apiVersion: '2025-08-27.basil', maxNetworkRetries: 2 });
  const started = now();
  async function collect<T>(list: AsyncIterable<T>, each: (item: T) => void): Promise<boolean> {
    let count = 0;
    for await (const item of list) {
      each(item);
      if (++count >= MAX_ITEMS_PER_LIST || now() - started > TIME_BUDGET_MS) return true;
    }
    return false;
  }
  const subscriptions: StripeSnapshot['subscriptions'] = [];
  const customerIds = new Set<string>();
  const chargeRefs = new Set<string>();
  const subscriptionsTruncated = await collect(stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] }), (sub) => {
    const customer = sub.customer;
    const item = sub.items.data[0];
    subscriptions.push({
      id: sub.id, customerId: typeof customer === 'string' ? customer : customer.id, status: sub.status,
      email: typeof customer === 'string' || customer.deleted ? '' : (customer.email ?? ''),
      priceId: item?.price.id ?? '', currentPeriodEnd: item ? new Date(item.current_period_end * 1000).toISOString().slice(0, 10) : '', cancelAtPeriodEnd: sub.cancel_at_period_end,
    });
  });
  const customersTruncated = await collect(stripe.customers.list({ limit: 100 }), (customer) => { customerIds.add(customer.id); });
  // Charges are the big list: read one month per request stream, several months at a time.
  const windows = monthWindows(since, new Date(now()));
  let chargesTruncated = false;
  let nextWindow = 0;
  const worker = async () => {
    while (nextWindow < windows.length) {
      const window = windows[nextWindow++];
      const cut = await collect(stripe.charges.list({ limit: 100, created: { gte: window.gte, lt: window.lt } }), (charge) => {
        chargeRefs.add(charge.id);
        if (typeof charge.payment_intent === 'string') chargeRefs.add(charge.payment_intent);
      });
      if (cut) chargesTruncated = true;
    }
  };
  await Promise.all(Array.from({ length: CHARGE_CONCURRENCY }, worker));
  return { subscriptions, customerIds, chargeRefs, truncated: { subscriptions: subscriptionsTruncated, customers: customersTruncated, charges: chargesTruncated } };
}

const COLUMNS = ['legacy_user_id', 'email', 'first_name', 'last_name', 'membership_status', 'paid_through', 'legacy_subscription_id', 'legacy_customer_id', 'stripe_subscription_id', 'stripe_customer_id', 'stripe_status'];
const row = (member: PlannedMember | null, stripe: { subscriptionId?: string; customerId?: string; status?: string; email?: string }): ReportRow => ({
  legacy_user_id: member?.legacyUserId ?? '', email: member?.email ?? stripe.email ?? '', first_name: member?.profile.firstName ?? '', last_name: member?.profile.lastName ?? '',
  membership_status: member?.membership.status ?? '', paid_through: member?.membership.paidThrough ?? '', legacy_subscription_id: member?.stripe.subscriptionId ?? '',
  legacy_customer_id: member?.stripe.customerId ?? '', stripe_subscription_id: stripe.subscriptionId ?? '', stripe_customer_id: stripe.customerId ?? '', stripe_status: stripe.status ?? '',
});

/** Pure comparison of the plan with a Stripe snapshot. Members removed by the cleanup rules are used only to recognise Stripe subscriptions that belong to them. */
export function reconcileWithStripe(members: PlannedMember[], snapshot: StripeSnapshot, orphans: LegacyImportPlan['orphans'] = []): { groups: ReportGroup[]; removedPeople: StripeReconciliation['removedPeople'] } {
  const bySubscription = new Map(snapshot.subscriptions.map((sub) => [sub.id, sub]));
  const importable = members.filter((member) => !member.exclusion && !member.held);
  const importableSubscriptionIds = new Set(importable.map((member) => member.stripe.subscriptionId).filter((id): id is string => Boolean(id)));
  // Subscriptions of people who are not being imported: say exactly what live Stripe holds for each one.
  const removedRefs = new Set<string>([
    ...orphans.flatMap((orphan) => orphan.subscriptionRefs),
    ...members.filter((member) => member.exclusion).flatMap((member) => member.subscriptionRefs),
  ]);
  const removedPeople = { checked: removedRefs.size, live: 0, cancelled: 0, notFound: 0, undetermined: snapshot.truncated.subscriptions };
  for (const ref of removedRefs) {
    const sub = bySubscription.get(ref);
    if (!sub) removedPeople.notFound++;
    else if (LIVE_SUBSCRIPTION.has(sub.status)) removedPeople.live++;
    else removedPeople.cancelled++;
  }
  const defs: Array<{ key: string; text: string; remedy: string | null; rows: ReportRow[] }> = [
    { key: 'stripe_subscription_missing', text: 'Legacy active subscription not found in live Stripe', remedy: null, rows: [] },
    { key: 'stripe_cancelled_legacy_active', text: 'Active in the legacy data but cancelled in live Stripe', remedy: null, rows: [] },
    { key: 'stripe_live_legacy_inactive', text: 'Not active in the legacy data but still billing in live Stripe', remedy: null, rows: [] },
    { key: 'stripe_customer_mismatch', text: 'The Stripe subscription belongs to a different customer than the legacy record', remedy: null, rows: [] },
    { key: 'stripe_customer_missing', text: 'Stored Stripe customer ID not found in live Stripe', remedy: null, rows: [] },
    { key: 'stripe_payments_missing', text: 'Member has Stripe payments that are not found in live Stripe', remedy: null, rows: [] },
    { key: 'stripe_live_for_removed_person', text: 'Still billing in live Stripe for a deleted user or a person removed by the cleanup rules', remedy: null, rows: [] },
    { key: 'stripe_live_unlinked', text: 'Still billing in live Stripe but not linked to any legacy record', remedy: null, rows: [] },
  ];
  const by = Object.fromEntries(defs.map((def) => [def.key, def]));
  for (const member of importable) {
    const subId = member.stripe.subscriptionId;
    const customerId = member.stripe.customerId;
    const stripeSub = subId ? bySubscription.get(subId) : undefined;
    if (subId && !stripeSub && !snapshot.truncated.subscriptions) by.stripe_subscription_missing.rows.push(row(member, {}));
    if (stripeSub) {
      const detail = { subscriptionId: stripeSub.id, customerId: stripeSub.customerId, status: stripeSub.status };
      if (DEAD_SUBSCRIPTION.has(stripeSub.status)) by.stripe_cancelled_legacy_active.rows.push(row(member, detail));
      if (customerId && stripeSub.customerId !== customerId) by.stripe_customer_mismatch.rows.push(row(member, detail));
    }
    if (!snapshot.truncated.customers && customerId && !snapshot.customerIds.has(customerId)) by.stripe_customer_missing.rows.push(row(member, { customerId }));
    const refs = member.payments.filter((payment) => payment.source === 'stripe' && payment.outcome === 'paid' && payment.reference && /^(ch|py|pi)_/.test(payment.reference)).map((payment) => payment.reference!);
    if (!snapshot.truncated.charges && refs.some((ref) => !snapshot.chargeRefs.has(ref))) by.stripe_payments_missing.rows.push(row(member, {}));
  }
  const memberByStripeSub = new Map(importable.filter((member) => member.stripe.subscriptionId).map((member) => [member.stripe.subscriptionId!, member]));
  const memberByCustomer = new Map(importable.filter((member) => member.stripe.customerId).map((member) => [member.stripe.customerId!, member]));
  for (const sub of snapshot.subscriptions) {
    if (!LIVE_SUBSCRIPTION.has(sub.status)) continue;
    const detail = { subscriptionId: sub.id, customerId: sub.customerId, status: sub.status, email: sub.email };
    if (importableSubscriptionIds.has(sub.id)) continue;
    if (removedRefs.has(sub.id)) { by.stripe_live_for_removed_person.rows.push(row(null, detail)); continue; }
    const owner = memberByStripeSub.get(sub.id) ?? memberByCustomer.get(sub.customerId);
    if (owner) by.stripe_live_legacy_inactive.rows.push(row(owner, detail));
    else by.stripe_live_unlinked.rows.push(row(null, detail));
  }
  const groups = defs.filter((def) => def.rows.length > 0).map((def) => ({ key: def.key, text: def.text, kind: 'review' as const, remedy: def.remedy, held: false, count: def.rows.length, columns: COLUMNS, rows: def.rows }));
  return { groups, removedPeople };
}

/** Runs the whole reconciliation; never throws, so a Stripe problem cannot stop the dry run itself. */
export async function runStripeReconciliation(members: PlannedMember[], orphans: LegacyImportPlan['orphans'], env: Record<string, string | undefined> = process.env, fetcher: (key: string, since: Date) => Promise<StripeSnapshot> = (k, since) => fetchStripeSnapshot(k, since)): Promise<StripeReconciliation> {
  const empty = { partial: false, skipped: [] as string[], removedPeople: { checked: 0, live: 0, cancelled: 0, notFound: 0, undetermined: true }, fetched: { subscriptions: 0, customers: 0, charges: 0 }, groups: [] as ReportGroup[] };
  const key = legacyStripeKey(env);
  if (!key) return { state: 'not_configured', message: 'No live Stripe key is configured for this report (LEGACY_STRIPE_SECRET_KEY), so nothing was compared with Stripe.', ...empty };
  if (!/^(?:sk|rk)_live_/.test(key)) return { state: 'unusable_key', message: 'LEGACY_STRIPE_SECRET_KEY is not a live-mode key, so it was not used.', ...empty };
  try {
    const paidDates = members.flatMap((member) => member.payments.filter((payment) => payment.source === 'stripe').map((payment) => payment.paidOn)).filter(Boolean).sort();
    const since = paidDates.length > 0 ? new Date(`${paidDates[0].slice(0, 10)}T00:00:00Z`) : new Date();
    since.setUTCDate(since.getUTCDate() - 7);
    const snapshot = await fetcher(key, since);
    const partial = Object.values(snapshot.truncated).some(Boolean);
    return {
      state: 'ok', partial,
      skipped: [
        ...(snapshot.truncated.subscriptions ? ['legacy subscriptions missing in Stripe'] : []),
        ...(snapshot.truncated.customers ? ['stored customer IDs missing in Stripe'] : []),
        ...(snapshot.truncated.charges ? ['Stripe payments missing in Stripe'] : []),
      ],
      message: partial ? `Stripe has more records than one report can read (${Object.entries(snapshot.truncated).filter(([, cut]) => cut).map(([name]) => name).join(', ')} cut short), so the checks that need the complete list were skipped and the rest may be incomplete.` : null,
      fetched: { subscriptions: snapshot.subscriptions.length, customers: snapshot.customerIds.size, charges: snapshot.chargeRefs.size },
      ...reconcileWithStripe(members, snapshot, orphans),
    };
  } catch {
    return { state: 'error', message: 'Live Stripe could not be read (check that the key has read access to customers, subscriptions and charges). The legacy report above is unaffected.', ...empty };
  }
}
