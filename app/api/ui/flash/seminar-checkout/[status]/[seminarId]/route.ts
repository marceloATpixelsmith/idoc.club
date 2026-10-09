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
  if (rows.length === 0) {
    // Keep the verified session ID across a bounded polling window; the webhook may
    // commit after Stripe sends the browser back. Never announce success prematurely.
    const attempt = Math.min(12, Math.max(0, Number(request.nextUrl.searchParams.get('attempt')) || 0));
    const retryUrl = new URL(request.url);
    retryUrl.searchParams.set('attempt', String(attempt + 1));
    const pending = attempt < 12;
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Seminar payment confirmation</title></head><body><main><h1>Registration confirmation pending</h1><p>${pending ? 'Your payment is being verified. This page will check again shortly.' : 'Your registration has not yet been confirmed. Please contact IDOC support before attempting another payment.'}</p><p><a href="${retryUrl.pathname + retryUrl.search}">Check registration status again</a></p></main></body></html>`;
    return new NextResponse(body, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        ...(pending ? { Refresh: `3; url=${retryUrl.pathname + retryUrl.search}` } : {}) },
    });
  }
  const code: UiFlashCode = 'seminar-registration-success';
  return setUiFlashOnResponse(response, code, targetPath);
}
