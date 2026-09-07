import 'server-only';

import { toCsv } from '@/lib/admin/csv';
import { exportAdminMembers, type MemberFilters } from '@/lib/membership/admin-memberships';

export async function GET(request?: Request) {
  try {
    const url = new URL(request?.url ?? 'http://localhost/api/admin/export/members');
    const filters = Object.fromEntries(url.searchParams) as MemberFilters;
    const rows = await exportAdminMembers(filters);
    return new Response(`\uFEFF${toCsv(rows, ['profileId', 'firstName', 'lastName', 'email', 'status', 'validUntil', 'membershipType', 'federation', 'country', 'region'])}`, {
      headers: {
        'Content-Disposition': 'attachment; filename="members.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to export members.';
    return Response.json({ error: message }, { status: message.includes('safe limit') ? 413 : 401 });
  }
}
