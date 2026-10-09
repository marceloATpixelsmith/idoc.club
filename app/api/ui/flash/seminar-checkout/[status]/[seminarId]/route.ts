import { NextRequest, NextResponse } from 'next/server';
import { setUiFlashOnResponse, type UiFlashCode } from '@/lib/ui/flash-state';

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
  const code: UiFlashCode = status === 'success' ? 'seminar-registration-success' : 'seminar-checkout-canceled';
  const response = NextResponse.redirect(new URL(targetPath, request.url), 302);
  return setUiFlashOnResponse(response, code, targetPath);
}
