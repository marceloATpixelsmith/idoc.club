import 'server-only';

import { toCsv } from '@/lib/admin/csv';
import { exportSeminarRegistrationsCsvRows } from '@/lib/seminars/registrations';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const seminarId = url.searchParams.get('seminarId');
    const rows = await exportSeminarRegistrationsCsvRows(seminarId);
    return new Response(`﻿${toCsv(rows, ['seminar_title', 'member_name', 'member_email', 'registration_status', 'payment_status', 'registered_at', 'canceled_at', 'paid_at'])}`, {
      headers: {
        'Content-Disposition': 'attachment; filename="seminar-registrations.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to export seminar registrations.';
    return Response.json({ error: message }, { status: message.includes('safe limit') ? 413 : 401 });
  }
}
