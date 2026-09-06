import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { DashboardTabs } from './dashboard-tabs';

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  await requireAccountAccess('profile');
  // No profile at all (an administrator, who is never a member and must never be gated by
  // membership payment status, or a member who hasn't completed onboarding yet) shows the full tab
  // bar -- this is only a UI convenience, never an authorization boundary (see dashboard-tabs.tsx),
  // and each individual page under /dashboard/* enforces its own real onboarding/entitlement
  // requirement independently.
  const member = await getOwnPrivateMember();
  const entitled = member ? isEntitled(member.entitlement, new Date().toISOString().slice(0, 10)) : true;

  return (
    <div className="flex flex-col min-h-[calc(100dvh-68px)] max-w-7xl mx-auto w-full">
      <DashboardTabs entitled={entitled} />
      <main className="flex-1 overflow-y-auto p-0 lg:p-4">{children}</main>
    </div>
  );
}
