import { redirect } from 'next/navigation';
import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { ProfileForm } from './profile-form';
import { getUser } from '@/lib/db/queries';
import { FlashBanner } from '@/components/ui/flash-banner';
import { readUiFlash } from '@/lib/ui/flash-state';

export default async function ProfilePage() {
  const user = await getUser();
  if (!user || user.accountState === 'onboarding') redirect('/dashboard');
  const actor = await requireAccountAccess('profile');
  const privileged = isPrivilegedActor(actor);
  const member = await getOwnPrivateMember();
  // An administrator/super_admin is never a member and must never be gated by membership payment
  // status or pushed into onboarding for lacking a member profile -- they just see the account
  // email field alone, no profile section.
  if (!member && !privileged) redirect('/dashboard');
  if (member && !privileged && !isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))) redirect('/dashboard');
  const flash = await readUiFlash('/dashboard/profile');
  return (
    <section className="py-4 lg:py-8 px-5 lg:px-8">
      <h1 className="text-2xl font-medium">My Profile</h1>
      {flash === 'profile-confirm-details' ? (
        <FlashBanner targetPath="/dashboard/profile">Welcome back! Please confirm your details below are still correct before continuing.</FlashBanner>
      ) : null}
      <ProfileForm email={user.emailDisplay ?? user.email} member={member} />
    </section>
  );
}
