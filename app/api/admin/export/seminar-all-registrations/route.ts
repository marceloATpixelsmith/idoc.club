import 'server-only';

import { toCsv } from '@/lib/admin/csv';
import { exportAllSeminarRegistrationsCsvRows } from '@/lib/seminars/registrations';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = Object.fromEntries(url.searchParams);
    const rows = await exportAllSeminarRegistrationsCsvRows(input);
    return new Response(`﻿${toCsv(rows, ['seminar_title', 'registrant_name', 'registrant_email', 'is_guest', 'registration_status', 'payment_status', 'payment_method_canonical_id', 'expected_amount_cents', 'currency', 'refund_ids', 'refunded_amount_cents', 'registered_at', 'canceled_at', 'paid_at'])}`, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'attachment; filename="seminar-registrations.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to export seminar registrations.';
    return Response.json({ error: message }, { status: message.includes('safe limit') ? 413 : 401 });
  }
}
