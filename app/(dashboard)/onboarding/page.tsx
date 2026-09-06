import { redirect } from 'next/navigation';
import { getUser } from '@/lib/db/queries';
import { requireAccountAccess } from '@/lib/membership/data-access';

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ membership?: string }> }) {
  const user = await getUser();
  if (!user) redirect('/sign-in');
  if (user.accountState === 'active') redirect('/dashboard');
  await requireAccountAccess('onboarding');
  const { membership } = await searchParams;
  const query = membership ? `?membership=${encodeURIComponent(membership)}` : '';
  redirect(`/dashboard${query}`);
}
