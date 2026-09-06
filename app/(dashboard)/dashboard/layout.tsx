import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { DashboardTabs } from './dashboard-tabs';
import { getUser } from '@/lib/db/queries';

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  const onboarding = user?.accountState === 'onboarding';
  const actor = await requireAccountAccess(onboarding ? 'onboarding' : 'profile');
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

  return (
    <div className="flex flex-col min-h-[calc(100dvh-96px)] max-w-7xl mx-auto w-full">
      <DashboardTabs entitled={entitled} />
      <main className="flex-1 overflow-y-auto p-0 lg:p-4">{children}</main>
    </div>
  );
}
