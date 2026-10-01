import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { client } from '@/lib/db/drizzle';
import { setUiFlashOnResponse } from '@/lib/ui/flash-state';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ checkoutId: string }> },
) {
  const { checkoutId } = await params;
  const id = Number(checkoutId);
  const targetPath = '/dashboard/membership';
  if (!Number.isInteger(id) || id <= 0) return NextResponse.redirect(new URL(targetPath, request.url), 302);

  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/sign-in', request.url), 302);

  const [owned] = await client<{ id: number }[]>`
    select s.id
    from idoc.membership_checkout_sessions s
    join idoc.profiles p on p.id = s.profile_id
    where s.id = ${id} and p.user_id = ${user.id} and s.status in ('open','completed')
    limit 1
  `;
  const response = NextResponse.redirect(new URL(targetPath, request.url), 302);
  return owned ? setUiFlashOnResponse(response, 'membership-checkout-success', targetPath) : response;
}
