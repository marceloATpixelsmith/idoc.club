import 'server-only';

import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, reconciliationFindings, reconciliationIgnores } from '@/lib/db/schema';

// The administrator's one manual control over the reconciliation report: IGNORE a specific issue so it stops appearing. The scan itself resolves everything with a
// known answer (reconciliation-resolver.ts); what is left needs a person, and when a person has dealt with it as far as they can (a member was contacted about
// repeated payment failures and will not or cannot update their card, say) there is no reason to keep seeing it.

type FindingRow = { details: unknown; externalCustomerId: string | null; externalSubscriptionId: string | null; id: number; kind: string; summary: string };

/** The stable identity of a scan-raised issue within its kind, or null for a notice raised by a Stripe notification (those are closed, not ignored). */
export function ignoreSubjectKey(finding: Pick<FindingRow, 'details' | 'externalCustomerId' | 'externalSubscriptionId' | 'kind'>): string | null {
  const details = finding.details && typeof finding.details === 'object' ? finding.details as Record<string, unknown> : {};
  if (finding.kind === 'seminar_payment_conflict') return details.source === 'daily_seminar_scan' && details.registrationId !== undefined ? `registration:${String(details.registrationId)}` : null;
  // Scan-raised status, schedule and Stripe-object findings carry their own `kind` inside details; notification-raised ones do not.
  if (details.kind === undefined) return null;
  return finding.externalSubscriptionId ?? finding.externalCustomerId ?? null;
}

/** Notices raised by Stripe notifications that stay until someone closes them: nothing is re-detected by the scan, so closing them is simply deleting them. */
export function isClosableNotice(finding: Pick<FindingRow, 'details' | 'kind'>): boolean {
  const details = finding.details && typeof finding.details === 'object' ? finding.details as Record<string, unknown> : {};
  if (['refund_conflict', 'dispute', 'chargeback'].includes(finding.kind)) return true;
  if (['status_conflict', 'pending_schedule_conflict'].includes(finding.kind)) return details.kind === undefined;
  if (finding.kind === 'seminar_payment_conflict') return details.source !== 'daily_seminar_scan';
  return false;
}

export function isIgnorableFinding(finding: Pick<FindingRow, 'details' | 'externalCustomerId' | 'externalSubscriptionId' | 'kind'>): boolean {
  return ignoreSubjectKey(finding) !== null || isClosableNotice(finding);
}

/** Ignores the named findings: a scan-raised issue is remembered (the scan then leaves it out of the report and out of its automatic actions until it clears or is restored);
 * a notification-raised notice is closed. Read, write and audit happen in one transaction; only ignorable findings are touched, whatever IDs are sent. */
export async function ignoreFindings(actorId: number, findingIds: number[]): Promise<number> {
  if (findingIds.length === 0) return 0;
  return db.transaction(async (tx) => {
    const rows = await tx.select({ details: reconciliationFindings.details, externalCustomerId: reconciliationFindings.externalCustomerId, externalSubscriptionId: reconciliationFindings.externalSubscriptionId,
      id: reconciliationFindings.id, kind: reconciliationFindings.kind, summary: reconciliationFindings.summary })
      .from(reconciliationFindings).where(inArray(reconciliationFindings.id, findingIds)).for('update');
    const ignorable = rows.filter(isIgnorableFinding);
    if (ignorable.length === 0) return 0;
    for (const finding of ignorable) {
      const subject = ignoreSubjectKey(finding);
      if (subject) {
        await tx.insert(reconciliationIgnores).values({ ignoredByUserId: actorId, kind: finding.kind, subjectKey: subject, summary: finding.summary.slice(0, 500) })
          .onConflictDoNothing({ target: [reconciliationIgnores.kind, reconciliationIgnores.subjectKey] });
      }
    }
    await tx.delete(reconciliationFindings).where(inArray(reconciliationFindings.id, ignorable.map((finding) => finding.id)));
    await tx.insert(auditLog).values(ignorable.map((finding) => ({ actorId, action: ignoreSubjectKey(finding) ? 'reconciliation.finding_ignored' : 'reconciliation.finding_closed',
      entityType: 'reconciliation_finding', entityId: String(finding.id), beforeJson: { kind: finding.kind, subject: ignoreSubjectKey(finding), summary: finding.summary },
      reason: 'Ignored from the Stripe Reconciliation page.' })));
    return ignorable.length;
  });
}

/** Puts an ignored issue back under the scan's eye; it reappears in the report on the next scan if it still exists. */
export async function restoreIgnoredIssue(actorId: number, ignoreId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const removed = await tx.delete(reconciliationIgnores).where(eq(reconciliationIgnores.id, ignoreId)).returning({ id: reconciliationIgnores.id, kind: reconciliationIgnores.kind, subjectKey: reconciliationIgnores.subjectKey });
    if (!removed[0]) return false;
    await tx.insert(auditLog).values({ actorId, action: 'reconciliation.ignore_restored', entityType: 'reconciliation_ignore', entityId: String(ignoreId),
      beforeJson: { kind: removed[0].kind, subject: removed[0].subjectKey }, reason: 'Restored from the Stripe Reconciliation page.' });
    return true;
  });
}
