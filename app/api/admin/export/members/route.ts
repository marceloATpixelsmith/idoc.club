import 'server-only';

import { toCsv } from '@/lib/admin/csv';
import { listAllMembersForExport } from '@/lib/membership/exports';

export async function GET() {
  try {
    const rows = await listAllMembersForExport();
    return new Response(toCsv(rows, ['firstName', 'lastName', 'email', 'status', 'validUntil']), {
      headers: {
        'Content-Disposition': 'attachment; filename="members.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
