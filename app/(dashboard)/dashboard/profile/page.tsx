import { redirect } from 'next/navigation';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { AccountForm } from './account-form';
import { ProfileForm } from './profile-form';

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ confirmDetails?: string }> }) {
  const member = await getOwnPrivateMember();
  if (!member) redirect('/onboarding');
  if (!isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))) redirect('/dashboard');
  const { confirmDetails } = await searchParams;
  return (
    <section className="space-y-8 p-4 lg:p-8">
      <div>
        <h1 className="mb-6 text-2xl font-medium">My Profile</h1>
        {confirmDetails ? (
          <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Welcome back! Please confirm your details below are still correct before continuing.
          </p>
        ) : null}
        <AccountForm />
      </div>
      <ProfileForm member={member} />
    </section>
  );
}
