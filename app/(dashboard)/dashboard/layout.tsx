import { redirect } from 'next/navigation';
import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError } from '@/lib/membership/authorization';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { DashboardTabs } from './dashboard-tabs';
import { getUser } from '@/lib/db/queries';
import { memberUnreadCount } from '@/lib/support/inbox';

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  const onboarding = user?.accountState === 'onboarding';
  // A cookie can be present but no longer valid server-side (revoked, stale, or otherwise
  // rejected -- middleware only checks that a canonical cookie exists, not that the session it
  // names is still registered/valid). Left uncaught, that threw straight into the generic
  // Next.js error boundary instead of prompting the member to sign back in -- confirmed in
  // production runtime errors since 2026-08-27 (LIVE-AUTH-019 finding). /admin/layout.tsx already
  // handles its own equivalent case (notFound(), since hiding admin route existence is the right
  // call there); a normal member-facing page should instead redirect to sign back in.
  let actor;
  try {
    actor = await requireAccountAccess(onboarding ? 'onboarding' : 'profile');
  } catch (error) {
    if (error instanceof AuthorizationError) redirect('/sign-in');
    throw error;
  }
  const privileged = isPrivilegedActor(actor);
  // An administrator/super_admin is never a member and must never be gated by membership payment
  // status -- whether or not they even have a member profile at all (in which case the profile's
  // own entitlement, if any, is irrelevant to them). A member who hasn't completed onboarding yet
  // is locked to My Membership with no tab bar, just like a completed but unpaid member. This is
  // only a UI convenience, never an authorization boundary (see dashboard-tabs.tsx), and each
  // individual page under /dashboard/* enforces its own onboarding/entitlement requirement.
  const member = onboarding ? null : await getOwnPrivateMember();
  const entitled = privileged || (!onboarding && member
    ? isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))
    : false);
  const supportUnread = entitled && !privileged ? await memberUnreadCount() : 0;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-96px)] w-full max-w-7xl flex-col lg:flex-row">
      <DashboardTabs entitled={entitled} memberSupport={!privileged} supportUnread={supportUnread} />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
