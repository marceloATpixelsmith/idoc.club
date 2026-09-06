import { redirect } from 'next/navigation';
import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { AccountForm } from './account-form';
import { ProfileForm } from './profile-form';
import { getUser } from '@/lib/db/queries';

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ confirmDetails?: string }> }) {
  const user = await getUser();
  if (user?.accountState === 'onboarding') redirect('/dashboard');
  const actor = await requireAccountAccess('profile');
  const privileged = isPrivilegedActor(actor);
  const member = await getOwnPrivateMember();
  // An administrator/super_admin is never a member and must never be gated by membership payment
  // status or pushed into onboarding for lacking a member profile -- they just see no profile form.
  if (!member && !privileged) redirect('/dashboard');
  if (member && !privileged && !isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))) redirect('/dashboard');
  const { confirmDetails } = await searchParams;
  return (
    <section className="space-y-8 p-4 lg:p-8">
      <div>
        <h1 className="mb-6 text-2xl font-medium">My Profile</h1>
        {confirmDetails ? (
          <p className="mb-6 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
            Welcome back! Please confirm your details below are still correct before continuing.
          </p>
        ) : null}
        <AccountForm />
      </div>
      {member ? <ProfileForm member={member} /> : null}
    </section>
  );
}
