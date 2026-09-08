import 'server-only';

import { toCsv } from '@/lib/admin/csv';
import { exportAdminMembers, type MemberFilters } from '@/lib/membership/admin-memberships';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = Object.fromEntries(url.searchParams) as MemberFilters;
    const rows = await exportAdminMembers(filters);
    return new Response(`\uFEFF${toCsv(rows, ['profileId', 'firstName', 'lastName', 'email', 'status', 'validUntil', 'membershipType', 'federation', 'country', 'region'])}`, {
      headers: {
        'Content-Disposition': 'attachment; filename="members.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('safe limit')) {
      return Response.json({ error: 'The export is too large. Narrow the filters and try again.' }, { status: 413 });
    }
    return Response.json({ error: 'Unable to export members.' }, { status: 500 });
  }
}
