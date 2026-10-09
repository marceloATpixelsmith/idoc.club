import { NextRequest, NextResponse } from 'next/server';
import { setUiFlashOnResponse } from '@/lib/ui/flash-state';

export async function GET(request: NextRequest) {
  const targetPath = '/dashboard/membership';
  const response = NextResponse.redirect(new URL(targetPath, request.url), 302);
  return setUiFlashOnResponse(response, 'membership-renew-panel', targetPath);
}
