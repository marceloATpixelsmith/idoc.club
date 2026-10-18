import 'server-only';

import { eq, inArray } from 'drizzle-orm';
import { toCsv } from '@/lib/admin/csv';
import { db } from '@/lib/db/drizzle';
import { auditLog, notificationOutbox, profiles, reconciliationFindings, users } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireAdministrator } from '@/lib/membership/authorization';
import { manualReviewReason, RECONCILIATION_KIND_LABELS, stripeContactDetails } from '@/lib/payments/reconciliation-report';
import { stripeIdForFinding } from '@/lib/payments/reconciliation-guide';

export async function GET(request: Request) {
  try
    {
    const actor = await requireAccountAccess('administration');
    requireAdministrator(actor);
    const url = new URL(request.url);
    const table = url.searchParams.get('table');
    const rawIds = url.searchParams.getAll('id');
    if ((table !== 'notifications' && table !== 'reconciliation') || !rawIds.length || rawIds.length > 100
      || rawIds.some((id) => !/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2_147_483_647))
      {
      return Response.json({ error: 'Select between 1 and 100 valid rows.' }, { status: 400 });
      }
    const ids = [...new Set(rawIds.map(Number))];
    let csv: string;
    let resultCount: number;
    if (table === 'notifications')
      {
      const rows = await db.select({
        attemptCount: notificationOutbox.attemptCount,
        createdAt: notificationOutbox.createdAt,
        kind: notificationOutbox.kind,
        lastErrorCode: notificationOutbox.lastErrorCode,
        sentAt: notificationOutbox.sentAt,
      }).from(notificationOutbox).where(inArray(notificationOutbox.id, ids));
      resultCount = rows.length;
      csv = toCsv(rows, ['kind', 'createdAt', 'sentAt', 'attemptCount', 'lastErrorCode']);
      }
    else
      {
      // Every reconciliation download names the member involved (when there is one) and says why the scan left the finding for a person.
      const rows = await db.select({
        createdAt: reconciliationFindings.createdAt,
        details: reconciliationFindings.details,
        email: users.email,
        externalCustomerId: reconciliationFindings.externalCustomerId,
        externalSubscriptionId: reconciliationFindings.externalSubscriptionId,
        firstName: profiles.firstName,
        kind: reconciliationFindings.kind,
        lastName: profiles.lastName,
        summary: reconciliationFindings.summary,
      }).from(reconciliationFindings)
        .leftJoin(profiles, eq(profiles.id, reconciliationFindings.profileId))
        .leftJoin(users, eq(users.id, profiles.userId))
        .where(inArray(reconciliationFindings.id, ids));
      resultCount = rows.length;
      csv = toCsv(rows.map((row) => {
        // No IDOC member (for example a payment failure on a Stripe subscription that was never imported): fall back to the contact details Stripe held when the scan ran.
        const stripeContact = stripeContactDetails(row.details);
        const hasMember = Boolean(row.firstName || row.email);
        return {
        detected: row.createdAt,
        memberEmail: row.email ?? stripeContact.email,
        memberFirstName: row.firstName ?? stripeContact.name,
        memberLastName: row.lastName ?? '',
        note: hasMember ? '' : stripeContact.email || stripeContact.name ? 'Not an IDOC member: the name and email are the contact details Stripe holds (the full name is in the first-name column).' : 'No IDOC member is linked to this item and Stripe held no contact details for it.',
        reasonForManualReview: manualReviewReason(row),
        stripeId: stripeIdForFinding(row),
        summary: row.summary,
        type: RECONCILIATION_KIND_LABELS[row.kind] ?? row.kind,
        };
      }), ['type', 'memberFirstName', 'memberLastName', 'memberEmail', 'stripeId', 'summary', 'reasonForManualReview', 'note', 'detected']);
      }
    await db.insert(auditLog).values({
      action: 'admin.selected_report.exported', actorId: actor.id,
      afterJson: { resultCount, selectedCount: ids.length, table },
      entityId: table, entityType: 'export',
    });
    return new Response(`\uFEFF${csv}`, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="selected-${table}.csv"`,
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
    }
  catch (error)
    {
    if (error instanceof AuthorizationError) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    return Response.json({ error: 'Unable to export selected rows.' }, { status: 500 });
    }
}
