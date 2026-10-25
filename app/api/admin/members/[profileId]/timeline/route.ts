import 'server-only';

import type { NextRequest } from 'next/server';
import { getMemberTimeline } from '@/lib/admin/member-timeline';
import { requireAdministrator } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';

export const dynamic = 'force-dynamic';

/** Read-only Member timeline for the administrator drawer. Administrator authorization is checked here and again inside the query. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    requireAdministrator(await requireAccountAccess('administration'));
  } catch {
    return Response.json({ error: 'Unauthorized' }, { headers, status: 401 });
  }
  const profileId = Number((await params).profileId);
  if (!Number.isInteger(profileId) || profileId <= 0) return Response.json({ error: 'Not found' }, { headers, status: 404 });
  try {
    const timeline = await getMemberTimeline(profileId, request.nextUrl.searchParams.get('from'), request.nextUrl.searchParams.get('to'));
    return timeline ? Response.json(timeline, { headers }) : Response.json({ error: 'Not found' }, { headers, status: 404 });
  } catch {
    return Response.json({ error: 'The timeline could not be loaded.' }, { headers, status: 500 });
  }
}
