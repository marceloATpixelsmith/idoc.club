import { redirect } from 'next/navigation';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { ProfileForm } from './profile-form';

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ confirmDetails?: string }> }) {
  const member = await getOwnPrivateMember();
  if (!member) redirect('/onboarding');
  const { confirmDetails } = await searchParams;
  return (
    <section className="p-4 lg:p-8">
      <h1 className="mb-6 text-2xl font-medium">Member profile</h1>
      {confirmDetails ? (
        <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Welcome back! Please confirm your details below are still correct before continuing.
        </p>
      ) : null}
      <ProfileForm member={member} />
    </section>
  );
}
