import 'server-only';

import { toCsv } from '@/lib/admin/csv';
import { listAllPaymentsForExport } from '@/lib/membership/exports';

export async function GET() {
  try {
    const rows = await listAllPaymentsForExport();
    return new Response(toCsv(rows, ['firstName', 'lastName', 'email', 'paidAt', 'amountCents', 'currency', 'source']), {
      headers: {
        'Content-Disposition': 'attachment; filename="payments.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
