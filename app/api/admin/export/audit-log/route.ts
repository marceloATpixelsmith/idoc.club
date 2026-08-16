import 'server-only';

import { toCsv } from '@/lib/admin/csv';
import { listAllAuditLogForExport } from '@/lib/membership/exports';

export async function GET() {
  try {
    const rows = await listAllAuditLogForExport();
    return new Response(toCsv(rows, ['createdAt', 'actorId', 'action', 'entityType', 'entityId', 'reason', 'beforeJson', 'afterJson']), {
      headers: {
        'Content-Disposition': 'attachment; filename="audit-log.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
