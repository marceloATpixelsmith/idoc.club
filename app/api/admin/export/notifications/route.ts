import 'server-only';

import { toCsv } from '@/lib/admin/csv';
import { listAllNotificationsForExport } from '@/lib/membership/exports';

export async function GET() {
  try {
    const rows = await listAllNotificationsForExport();
    return new Response(toCsv(rows, ['firstName', 'lastName', 'email', 'kind', 'createdAt', 'sentAt']), {
      headers: {
        'Content-Disposition': 'attachment; filename="notifications.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
