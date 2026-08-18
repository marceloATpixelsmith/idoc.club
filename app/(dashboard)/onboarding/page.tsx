import { redirect } from 'next/navigation';
import { getUser } from '@/lib/db/queries';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { OnboardingWizard } from './onboarding-wizard';

export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) redirect('/sign-in');
  if (user.accountState === 'active') redirect('/dashboard');
  await requireAccountAccess('onboarding');
  return <OnboardingWizard />;
}
