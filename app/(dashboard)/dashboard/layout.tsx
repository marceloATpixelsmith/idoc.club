import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { DashboardTabs } from './dashboard-tabs';

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const actor = await requireAccountAccess('profile');
  const privileged = isPrivilegedActor(actor);
  // An administrator/super_admin is never a member and must never be gated by membership payment
  // status -- whether or not they even have a member profile at all (in which case the profile's
  // own entitlement, if any, is irrelevant to them). A member who hasn't completed onboarding yet
  // (no profile) also always shows the full tab bar. This is only a UI convenience, never an
  // authorization boundary (see dashboard-tabs.tsx), and each individual page under /dashboard/*
  // enforces its own real onboarding/entitlement requirement independently.
  const member = await getOwnPrivateMember();
  const entitled = privileged || (member ? isEntitled(member.entitlement, new Date().toISOString().slice(0, 10)) : true);

  return (
    <div className="flex flex-col min-h-[calc(100dvh-96px)] max-w-7xl mx-auto w-full">
      <DashboardTabs entitled={entitled} />
      <main className="flex-1 overflow-y-auto p-0 lg:p-4">{children}</main>
    </div>
  );
}
