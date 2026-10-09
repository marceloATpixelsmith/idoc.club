import { redirect } from 'next/navigation';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { getUser } from '@/lib/db/queries';
import { parseMemberClassification } from '@/lib/membership/classification';
import { OnboardingWizard } from '@/app/(dashboard)/onboarding/onboarding-wizard';

/** '/dashboard' is the account's single entry point: it hosts onboarding directly (so
 * next.config.ts's geolocation Permissions-Policy exception, scoped to exactly this path, still
 * covers the wizard's address autocomplete), and forwards every other account straight to
 * /dashboard/membership -- whose own URL matches its "My Membership" nav label, per the other
 * dashboard subpages (profile, security, support). */
export default async function DashboardEntryPage({ searchParams }: { searchParams: Promise<{ membership?: string }> }) {
  const user = await getUser();
  const onboarding = user?.accountState === 'onboarding';
  await requireAccountAccess(onboarding ? 'onboarding' : 'profile');

  if (onboarding) {
    const { membership } = await searchParams;
    return (
      <main className="flex-1 py-4 lg:py-8 px-5 lg:px-8">
        <OnboardingWizard initialClassification={parseMemberClassification(membership)} />
      </main>
    );
  }

  redirect('/dashboard/membership');
}
