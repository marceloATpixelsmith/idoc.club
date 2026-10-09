import { NextRequest, NextResponse } from 'next/server';
import { setUiFlashOnResponse, type UiFlashCode } from '@/lib/ui/flash-state';
import { client } from '@/lib/db/drizzle';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ seminarId: string; status: string }> },
) {
  const { seminarId, status } = await params;
  const id = Number(seminarId);
  if (!Number.isInteger(id) || id <= 0 || (status !== 'success' && status !== 'canceled')) {
    return NextResponse.redirect(new URL('/seminars', request.url), 302);
  }

  const targetPath = `/seminars/${id}`;
  const response = NextResponse.redirect(new URL(targetPath, request.url), 302);
  if (status === 'canceled') {
    return setUiFlashOnResponse(response, 'seminar-checkout-canceled', targetPath);
  }

  // A Checkout success redirect is not proof of a registered, paid guest: the webhook
  // can still be processing, or can refund if eligibility has changed.
  const sessionId = request.nextUrl.searchParams.get('session_id');
  if (!sessionId || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) return response;
  const rows = await client<{ id: number }[]>`select id from seminar_registrations
    where seminar_id=${id} and stripe_checkout_session_id=${sessionId}
    and registration_status='registered' and payment_status='paid'
    and profile_id is null limit 1`;
  if (rows.length === 0) return response;
  const code: UiFlashCode = 'seminar-registration-success';
  return setUiFlashOnResponse(response, code, targetPath);
}
