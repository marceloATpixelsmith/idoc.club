import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, billingAccounts, reconciliationFindings, subscriptions } from '@/lib/db/schema';
import { logError } from '@/lib/observability/logger';
import { planOrphanCancellations, type OrphanCancellationPlan, type OrphanSubscription } from './reconciliation';
import { remediationAllowed } from './remediation-gate';
import { getStripeServerClient } from './stripe-client';

// The only code that writes to Stripe on behalf of the reconciliation report. IDOC's database is the system of record, so a
// Stripe object IDOC has no record of may be removed -- but only in the production deployment against live Stripe, never from
// staging, a rehearsal read key or a test key, and never while the launch hold is on.

export type RemediationStripeClient = {
  charges?: { list: (params: { created?: { gte: number }; customer: string; limit: number }) => Promise<{ data: Array<{ id: string }> }> };
  customers: {
    del: (id: string) => Promise<unknown>;
    retrieve: (id: string) => Promise<{ created?: number; deleted?: boolean; email?: string | null; id: string; name?: string | null }>;
  };
  invoices?: { list: (params: { customer: string; limit: number; status: 'open' }) => Promise<{ data: Array<{ id: string }> }> };
  subscriptions: {
    cancel: (id: string, params?: Record<string, never>, options?: { idempotencyKey: string }) => Promise<unknown>;
    list?: (params: { customer: string; limit: number; starting_after?: string; status: 'all' }) => Promise<{ data: Array<{ id: string; status: string }>; has_more?: boolean }>;
    retrieve: (id: string) => Promise<{ id: string; status: string }>;
  };
};

const OPEN = new Set(['active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paused']);
export const CUSTOMER_RECENT_CHARGE_DAYS = 90;

export type OrphanCancellationOutcome = { cancelled: string[]; failed: string[]; plan: OrphanCancellationPlan };

/** Cancels the orphaned subscriptions the plan allows. Every cancellation re-checks the local table and Stripe immediately beforehand and is audit-logged. */
export async function cancelOrphanedSubscriptions(stripe: RemediationStripeClient, orphans: OrphanSubscription[], now: Date = new Date()): Promise<OrphanCancellationOutcome> {
  const previous = await db.select({ createdAt: reconciliationFindings.createdAt, id: reconciliationFindings.externalSubscriptionId })
    .from(reconciliationFindings).where(eq(reconciliationFindings.kind, 'orphaned_subscription'));
  const previouslyFlagged = new Map(previous.flatMap((row) => (row.id ? [[row.id, row.createdAt] as const] : [])));
  const plan = planOrphanCancellations(orphans, previouslyFlagged, now);
  const cancelled: string[] = [];
  const failed: string[] = [];
  if (plan.tripped) {
    logError('reconciliation_orphan_cancel_paused');
    await db.insert(auditLog).values({ action: 'reconciliation.orphan_cancel_paused', entityType: 'reconciliation', entityId: 'orphaned_subscription',
      afterJson: { orphanCount: orphans.length }, reason: 'More orphaned subscriptions than the safety limit in one run; none were cancelled.' });
    return { cancelled, failed, plan };
  }
  for (const orphan of plan.cancel) {
    try {
      const [local] = await db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.externalSubscriptionId, orphan.id)).limit(1);
      if (local) continue;
      const live = await stripe.subscriptions.retrieve(orphan.id);
      if (!OPEN.has(live.status)) continue;
      await stripe.subscriptions.cancel(orphan.id, {}, { idempotencyKey: `idoc-orphan-subscription-cancel-${orphan.id}` });
      await db.insert(auditLog).values({ action: 'reconciliation.orphan_subscription_canceled', entityType: 'stripe_subscription', entityId: orphan.id,
        beforeJson: { customer: orphan.customer, status: live.status }, reason: 'No matching IDOC subscription; IDOC records are authoritative.' });
      cancelled.push(orphan.id);
    } catch {
      failed.push(orphan.id);
    }
  }
  if (failed.length) logError('reconciliation_scan_failed');
  return { cancelled, failed, plan };
}

export type CustomerCleanupResult = {
  csv: string;
  deleted: string[];
  failed: string[];
  skipped: Array<{ id: string; reason: string }>;
};

async function isLinked(customerId: string) {
  const [row] = await db.select({ id: billingAccounts.id }).from(billingAccounts).where(eq(billingAccounts.externalCustomerId, customerId)).limit(1);
  return Boolean(row);
}

/** Every subscription of the customer, following Stripe's pagination, so a live one on a later page can never be missed. */
async function allSubscriptions(stripe: RemediationStripeClient, customer: string) {
  const all: Array<{ id: string; status: string }> = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await stripe.subscriptions.list!({ customer, limit: 100, status: 'all', ...(cursor ? { starting_after: cursor } : {}) });
    all.push(...page.data);
    cursor = page.data.at(-1)?.id;
    if (!page.has_more || !cursor) return all;
  }
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Deletes Stripe customers the last scan reported as having no IDOC billing account, after re-checking each one. */
export async function deleteUnlinkedCustomers(actorId: number, stripe: RemediationStripeClient = getStripeServerClient() as unknown as RemediationStripeClient, now: Date = new Date(), testBypassGate = false): Promise<CustomerCleanupResult> {
  if (testBypassGate && process.env.NODE_ENV !== 'test') throw new Error('Gate overrides are test-only.');
  if (!testBypassGate && !remediationAllowed()) throw new Error('Deleting Stripe customers is only available in the production deployment with live billing released.');
  if (!stripe.subscriptions.list || !stripe.invoices || !stripe.charges) throw new Error('Customer cleanup needs subscription, invoice and charge lookups.');
  const rows = await db.select({ id: reconciliationFindings.externalCustomerId }).from(reconciliationFindings).where(eq(reconciliationFindings.kind, 'unlinked_customer'));
  const ids = [...new Set(rows.flatMap((row) => (row.id ? [row.id] : [])))];
  const since = Math.floor(now.getTime() / 1000) - CUSTOMER_RECENT_CHARGE_DAYS * 86_400;
  const result: CustomerCleanupResult = { csv: '', deleted: [], failed: [], skipped: [] };
  const lines = ['customer_id,email,name,created_utc,outcome'];
  for (const id of ids) {
    let outcome = 'deleted';
    let email: string | null | undefined;
    let name: string | null | undefined;
    let created: number | undefined;
    try {
      if (await isLinked(id)) { result.skipped.push({ id, reason: 'now linked to an IDOC billing account' }); outcome = 'skipped: linked'; continue; }
      const customer = await stripe.customers.retrieve(id);
      ({ email, name, created } = customer);
      if (customer.deleted) { outcome = 'skipped: already deleted'; result.skipped.push({ id, reason: 'already deleted' }); continue; }
      const [subs, invoices, charges] = await Promise.all([
        allSubscriptions(stripe, id),
        stripe.invoices!.list({ customer: id, limit: 1, status: 'open' }),
        stripe.charges!.list({ created: { gte: since }, customer: id, limit: 1 }),
      ]);
      const reason = subs.some((sub) => sub.status !== 'canceled' && sub.status !== 'incomplete_expired') ? 'has a live subscription'
        : invoices.data.length ? 'has an open invoice' : charges.data.length ? `charged in the last ${CUSTOMER_RECENT_CHARGE_DAYS} days` : null;
      if (reason) { outcome = `skipped: ${reason}`; result.skipped.push({ id, reason }); continue; }
      // Re-check the link immediately before the irreversible call: a checkout recovery or import may have linked it since the scan.
      if (await isLinked(id)) { result.skipped.push({ id, reason: 'now linked to an IDOC billing account' }); outcome = 'skipped: linked'; continue; }
      await stripe.customers.del(id);
      result.deleted.push(id);
      // The deletion already happened: a failure to write its audit row must not turn it into a "failed" customer, so it is reported instead.
      await db.insert(auditLog).values({ actorId, action: 'reconciliation.unlinked_customer_deleted', entityType: 'stripe_customer', entityId: id,
        beforeJson: { created: created ?? null }, reason: 'No matching IDOC billing account; deleted from the Stripe Reconciliation page.' })
        .catch(() => { logError('reconciliation_scan_failed'); });
    } catch {
      outcome = 'failed';
      result.failed.push(id);
    } finally {
      lines.push([id, email, name, created ? new Date(created * 1000).toISOString() : '', outcome].map(csvCell).join(','));
    }
  }
  if (result.deleted.length) await db.delete(reconciliationFindings).where(and(eq(reconciliationFindings.kind, 'unlinked_customer'), inArray(reconciliationFindings.externalCustomerId, result.deleted)));
  result.csv = lines.join('\n');
  return result;
}
