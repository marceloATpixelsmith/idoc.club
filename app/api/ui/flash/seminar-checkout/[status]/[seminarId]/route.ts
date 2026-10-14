import { NextRequest, NextResponse } from 'next/server';
import { setUiFlashOnResponse } from '@/lib/ui/flash-state';

// Stripe Checkout's cancel redirect for a member's seminar/course payment. (Successful member payments
// return directly to My Seminars; the guest success flow no longer exists.)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ seminarId: string; status: string }> },
) {
  const { seminarId, status } = await params;
  const id = Number(seminarId);
  if (!Number.isInteger(id) || id <= 0 || status !== 'canceled') {
    return NextResponse.redirect(new URL('/seminars', request.url), 302);
  }
  const targetPath = `/seminars/${id}`;
  return setUiFlashOnResponse(NextResponse.redirect(new URL(targetPath, request.url), 302), 'seminar-checkout-canceled', targetPath);
}
