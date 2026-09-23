import 'server-only';

import { inArray } from 'drizzle-orm';
import { toCsv } from '@/lib/admin/csv';
import { db } from '@/lib/db/drizzle';
import { auditLog, notificationOutbox, reconciliationFindings } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireAdministrator } from '@/lib/membership/authorization';

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
        id: notificationOutbox.id,
        kind: notificationOutbox.kind,
        lastErrorCode: notificationOutbox.lastErrorCode,
        sentAt: notificationOutbox.sentAt,
      }).from(notificationOutbox).where(inArray(notificationOutbox.id, ids));
      resultCount = rows.length;
      csv = toCsv(rows, ['id', 'kind', 'createdAt', 'sentAt', 'attemptCount', 'lastErrorCode']);
      }
    else
      {
      const rows = await db.select({
        createdAt: reconciliationFindings.createdAt,
        id: reconciliationFindings.id,
        kind: reconciliationFindings.kind,
        profileId: reconciliationFindings.profileId,
        summary: reconciliationFindings.summary,
      }).from(reconciliationFindings).where(inArray(reconciliationFindings.id, ids));
      resultCount = rows.length;
      csv = toCsv(rows, ['id', 'kind', 'summary', 'profileId', 'createdAt']);
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
