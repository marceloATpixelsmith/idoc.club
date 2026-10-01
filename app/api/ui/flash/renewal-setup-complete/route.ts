import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { client } from '@/lib/db/drizzle';
import { setUiFlashOnResponse } from '@/lib/ui/flash-state';

export async function GET(request: NextRequest) {
  const targetPath = '/dashboard/membership';
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/sign-in', request.url), 302);

  const [pending] = await client<{ id: number }[]>`
    select rp.id
    from idoc.renewal_preferences rp
    join idoc.profiles p on p.id = rp.profile_id
    where p.user_id = ${user.id}
      and rp.pending_mode = 'recurring'
      and rp.transition_state = 'awaiting_setup'
      and rp.external_checkout_session_id is not null
    limit 1
  `;
  const response = NextResponse.redirect(new URL(targetPath, request.url), 302);
  return pending ? setUiFlashOnResponse(response, 'membership-renewal-setup-success', targetPath) : response;
}
