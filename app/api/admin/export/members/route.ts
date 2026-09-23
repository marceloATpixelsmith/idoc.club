import 'server-only';

import { toCsv } from '@/lib/admin/csv';
import { exportAdminMembers, type MemberFilters } from '@/lib/membership/admin-memberships';
import { AuthorizationError } from '@/lib/membership/authorization';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = Object.fromEntries(url.searchParams) as MemberFilters;
    const rawSelected = url.searchParams.getAll('selectedUserId');
    if (rawSelected.length > 100 || rawSelected.some((value) => !/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2_147_483_647)) {
      return Response.json({ error: 'Select no more than 100 valid member rows.' }, { status: 400 });
    }
    const selectedUserIds = rawSelected.length ? [...new Set(rawSelected.map(Number))] : undefined;
    const rows = await exportAdminMembers(filters, selectedUserIds);
    return new Response(`\uFEFF${toCsv(rows, ['profileId', 'firstName', 'lastName', 'email', 'status', 'validUntil', 'membershipType', 'federation', 'country', 'region'])}`, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'attachment; filename="members.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('safe limit')) {
      return Response.json({ error: 'The export is too large. Narrow the filters and try again.' }, { status: 413 });
    }
    if (error instanceof AuthorizationError) {
      return Response.json({ error: 'You are not authorized to export members.' }, { status: 401 });
    }
    return Response.json({ error: 'Unable to export members.' }, { status: 500 });
  }
}
