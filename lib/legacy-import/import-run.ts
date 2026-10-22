import 'server-only';

import { eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db/drizzle';
import { getDatabaseSchemaName } from '@/lib/db/schema-name';
import {
  auditLog, billingAccounts, memberships, migrationMap, paymentRefunds, payments, professionalRoles, profiles, renewalPreferences, subscriptions, users,
} from '@/lib/db/schema';
import { emailDisplayForm, normalizeEmail } from '@/lib/membership/validation';
import { memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';
import { validateStripeKey } from '@/lib/runtime/stripe-configuration.mjs';
import { buildMemberRows, type ImportMemberRows } from './import-rows';
import type { StripeSnapshot } from './stripe-reconcile';
import type { DryRunReport, LegacyImportPlan } from './transform';

/**
 * The write step of the temporary legacy import (docs/03 section 12). One database transaction: it either writes everything
 * or nothing. It creates rows only; it sends no email, queues no notification and never calls Stripe. It refuses to run unless
 * the member communications and billing hold is on, the report has nothing left for the operator to decide, and the Stripe
 * comparison was complete.
 *
 * TEMPORARY legacy-import support code: delete with the rest of lib/legacy-import once the migration is finished.
 */
export class LegacyImportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyImportBlockedError';
  }
}

export interface LegacyImportSummary {
  schema: string;
  imported: number;
  alreadyImported: number;
  payments: number;
  refunds: number;
  subscriptions: number;
  billingAccounts: number;
  skippedZeroAmountPayments: number;
  membersWithoutStorableSubscription: number;
}

const CHUNK = 200;
function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** Everything that must be true before a single row is written. Throws LegacyImportBlockedError with a plain-language reason. */
export function assertImportAllowed(report: DryRunReport, environment: Record<string, string | undefined> = process.env, schema = getDatabaseSchemaName()) {
  if (!memberCommunicationsDisabled(environment)) {
    throw new LegacyImportBlockedError('The member communications and billing hold is off. Turn it on (DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING must not be "false") before importing, so nothing can be emailed.');
  }
  if (schema === 'idoc_staging') {
    let mode: string;
    try { mode = validateStripeKey(environment).mode; } catch { throw new LegacyImportBlockedError('Staging\'s Stripe key could not be validated.'); }
    if (mode !== 'test') throw new LegacyImportBlockedError('Staging must use a Stripe test key before a legacy import.');
  }
  const stripe = report.stripeReconciliation;
  if (!stripe || stripe.state !== 'ok' || stripe.partial) {
    throw new LegacyImportBlockedError('The comparison with live Stripe did not complete, so the import cannot be checked against it. Fix that and run the dry run again.');
  }
  const decisions = [...report.review, ...stripe.groups];
  if (decisions.length > 0) {
    throw new LegacyImportBlockedError(`${decisions.length} kind(s) of problem still need your decision (see "Needs a decision" and the Stripe comparison). Resolve them and run the dry run again.`);
  }
  if (report.importable === 0) throw new LegacyImportBlockedError('There is nobody to import.');
}

const LISTED_CLASHES = 20;

/** One line naming a legacy member the way the operator knows them: legacy ID, name and email as exported. */
function describeLegacyMember(plan: LegacyImportPlan, legacyUserId: string): string {
  const member = plan.members.find((candidate) => candidate.legacyUserId === legacyUserId);
  if (!member) return `legacy user ${legacyUserId}`;
  const name = `${member.profile.firstName} ${member.profile.lastName}`.trim();
  return `legacy user ${legacyUserId}: ${name || '(no name)'}, ${member.emailDisplay}`;
}

function listWithOverflow(lines: string[]): string {
  return lines.slice(0, LISTED_CLASHES).map((line) => `• ${line}`).join('\n') + (lines.length > LISTED_CLASHES ? `\n…and ${lines.length - LISTED_CLASHES} more` : '');
}

export async function runLegacyImport(input: { plan: LegacyImportPlan; report: DryRunReport; snapshot: StripeSnapshot; actorId: number; fileFingerprints: string[]; fileNames?: string[] }): Promise<LegacyImportSummary> {
  assertImportAllowed(input.report);
  const schema = getDatabaseSchemaName();
  const candidates = input.plan.members.filter((member) => !member.exclusion && !member.held);
  const forms = { normalizeEmail, emailDisplayForm };

  return db.transaction(async (tx) => {
    const mapped = new Set((await tx.select({ id: migrationMap.legacyId }).from(migrationMap).where(sql`${migrationMap.legacyType} = 'wp_user'`)).map((row) => row.id));
    const todo = candidates.filter((member) => !mapped.has(member.legacyUserId));
    const rows: ImportMemberRows[] = todo.map((member) => buildMemberRows(member, input.snapshot, forms));

    const emails = rows.map((row) => row.user.email);
    const existingByEmail = new Map<string, string>();
    for (const part of chunks(emails)) {
      const found = await tx.select({ id: users.id, email: users.email, state: users.accountState, firstName: profiles.firstName, lastName: profiles.lastName })
        .from(users).leftJoin(profiles, eq(profiles.userId, users.id)).where(inArray(sql`lower(${users.email})`, part));
      for (const row of found) {
        const name = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
        existingByEmail.set(row.email.toLowerCase(), `existing account #${row.id}: ${name || 'no profile name'}, ${row.email}, ${row.state}`);
      }
    }
    if (existingByEmail.size > 0) {
      const clashing = rows.filter((row) => existingByEmail.has(row.user.email));
      const lines = clashing.map((row) => `${describeLegacyMember(input.plan, row.legacyUserId)}  ↔  ${existingByEmail.get(row.user.email)}`);
      throw new LegacyImportBlockedError(`${clashing.length} member(s) already have an account in this environment with the same email. Nothing was imported. Decide what to do with those accounts first.\n${listWithOverflow(lines)}`);
    }

    // Stripe IDs are unique in the database. A clash (inside the files, or with data already here) would otherwise be dropped
    // silently, leaving a member imported without their billing link or history, so it stops the whole run instead.
    const duplicates = (values: string[]) => values.filter((value, index) => values.indexOf(value) !== index);
    const customerIds = rows.flatMap((row) => (row.billingCustomerId ? [row.billingCustomerId] : []));
    const subscriptionIds = rows.flatMap((row) => (row.subscription ? [row.subscription.externalSubscriptionId] : []));
    const paymentIds = rows.flatMap((row) => row.payments.flatMap((payment) => (payment.externalPaymentId ? [payment.externalPaymentId] : [])));
    const insideFiles = new Set([...duplicates(customerIds), ...duplicates(subscriptionIds), ...duplicates(paymentIds)]);
    const existingIds = new Set<string>();
    for (const part of chunks(customerIds)) for (const row of await tx.select({ id: billingAccounts.externalCustomerId }).from(billingAccounts).where(inArray(billingAccounts.externalCustomerId, part))) existingIds.add(row.id);
    for (const part of chunks(subscriptionIds)) for (const row of await tx.select({ id: subscriptions.externalSubscriptionId }).from(subscriptions).where(inArray(subscriptions.externalSubscriptionId, part))) existingIds.add(row.id);
    for (const part of chunks(paymentIds)) for (const row of await tx.select({ id: payments.externalPaymentId }).from(payments).where(inArray(payments.externalPaymentId, part))) if (row.id) existingIds.add(row.id);
    if (insideFiles.size > 0 || existingIds.size > 0) {
      const clashing = rows.filter((row) => [row.billingCustomerId, row.subscription?.externalSubscriptionId, ...row.payments.map((payment) => payment.externalPaymentId)]
        .some((id) => id && (insideFiles.has(id) || existingIds.has(id)))).map((row) => row.legacyUserId);
      throw new LegacyImportBlockedError(`${clashing.length} member(s) have a Stripe customer, subscription or payment ID that is used twice in the files or already exists in this environment. Nothing was imported.\n${listWithOverflow(clashing.map((legacyUserId) => describeLegacyMember(input.plan, legacyUserId)))}`);
    }

    const userIdByLegacy = new Map<string, number>();
    for (const part of chunks(rows)) {
      const inserted = await tx.insert(users).values(part.map((row) => row.user)).returning({ id: users.id, email: users.email });
      const byEmail = new Map(inserted.map((row) => [row.email, row.id]));
      for (const row of part) userIdByLegacy.set(row.legacyUserId, byEmail.get(row.user.email)!);
    }

    const profileIdByLegacy = new Map<string, number>();
    for (const part of chunks(rows)) {
      const inserted = await tx.insert(profiles).values(part.map((row) => ({ ...row.profile, userId: userIdByLegacy.get(row.legacyUserId)! }))).returning({ id: profiles.id, userId: profiles.userId });
      const byUser = new Map(inserted.map((row) => [row.userId, row.id]));
      for (const row of part) profileIdByLegacy.set(row.legacyUserId, byUser.get(userIdByLegacy.get(row.legacyUserId)!)!);
    }
    const profileId = (row: ImportMemberRows) => profileIdByLegacy.get(row.legacyUserId)!;

    for (const part of chunks(rows.flatMap((row) => row.roles.map((role) => ({ ...role, profileId: profileId(row) }))))) await tx.insert(professionalRoles).values(part);
    for (const part of chunks(rows)) await tx.insert(memberships).values(part.map((row) => ({ ...row.membership, profileId: profileId(row) })));

    const billing = rows.filter((row) => row.billingCustomerId);
    let billingCount = 0;
    for (const part of chunks(billing)) {
      const inserted = await tx.insert(billingAccounts).values(part.map((row) => ({ profileId: profileId(row), externalCustomerId: row.billingCustomerId! }))).returning({ id: billingAccounts.id });
      billingCount += inserted.length;
    }
    const withSubscription = rows.filter((row) => row.subscription);
    let subscriptionCount = 0;
    for (const part of chunks(withSubscription)) {
      const inserted = await tx.insert(subscriptions).values(part.map((row) => ({ ...row.subscription!, profileId: profileId(row) }))).returning({ id: subscriptions.id });
      subscriptionCount += inserted.length;
    }
    for (const part of chunks(rows)) await tx.insert(renewalPreferences).values(part.map((row) => ({ ...row.renewal, profileId: profileId(row) })));

    let paymentCount = 0;
    let refundCount = 0;
    const paymentValues = (row: ImportMemberRows, payment: ImportMemberRows['payments'][number]) => ({
      profileId: profileId(row), source: payment.source, externalPaymentId: payment.externalPaymentId, amountCents: payment.amountCents, currency: 'EUR',
      paidAt: payment.paidAt, reference: payment.reference, reason: payment.reason, administratorId: payment.source === 'legacy_import' ? input.actorId : null,
    });
    const plain = rows.flatMap((row) => row.payments.filter((payment) => !payment.refunded).map((payment) => paymentValues(row, payment)));
    for (const part of chunks(plain)) paymentCount += (await tx.insert(payments).values(part).returning({ id: payments.id })).length;
    for (const row of rows) {
      for (const payment of row.payments.filter((candidate) => candidate.refunded)) {
        const [stored] = await tx.insert(payments).values(paymentValues(row, payment)).returning({ id: payments.id });
        paymentCount += 1;
        await tx.insert(paymentRefunds).values({
          membershipPaymentId: stored.id, idempotencyKey: `legacy-import-refund-${row.legacyUserId}-${payment.legacyTransactionId}`, amountCents: payment.amountCents,
          currency: 'EUR', status: 'succeeded', reason: 'Imported from MemberPress: the legacy transaction was marked refunded', administratorId: input.actorId, refundedAt: payment.paidAt,
        });
        refundCount += 1;
      }
    }

    const mapRows = rows.map((row) => ({ legacyType: 'wp_user', legacyId: row.legacyUserId, newEntityId: String(userIdByLegacy.get(row.legacyUserId)), disposition: 'imported', confidence: 'exact', reviewedBy: input.actorId }));
    for (const part of chunks(mapRows)) await tx.insert(migrationMap).values(part);

    const summary: LegacyImportSummary = {
      schema, imported: rows.length, alreadyImported: candidates.length - todo.length, payments: paymentCount, refunds: refundCount, subscriptions: subscriptionCount, billingAccounts: billingCount,
      skippedZeroAmountPayments: rows.reduce((sum, row) => sum + row.skipped.zeroAmountPayments, 0), membersWithoutStorableSubscription: rows.filter((row) => row.skipped.unstorableSubscription).length,
    };
    await tx.insert(auditLog).values({
      actorId: input.actorId, action: 'admin.legacy_import.import', entityType: 'legacy_import', entityId: input.fileFingerprints.map((value) => value.slice(0, 12)).join('+'),
      afterJson: { ...summary, files: input.fileFingerprints, fileNames: input.fileNames ?? [] }, reason: 'Temporary legacy member import',
    });
    return summary;
  });
}
