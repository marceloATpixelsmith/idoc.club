import { NextRequest, NextResponse } from 'next/server';
import { setUiFlashOnResponse } from '@/lib/ui/flash-state';

// Browser-return landing only. Stripe webhook processing remains authoritative for entitlement;
// this route simply creates one-time UI feedback and immediately redirects to a clean URL.
export async function GET(request: NextRequest) {
  const targetPath = '/dashboard/membership';
  const response = NextResponse.redirect(new URL(targetPath, request.url), 302);
  return setUiFlashOnResponse(response, 'membership-checkout-success', targetPath);
}
