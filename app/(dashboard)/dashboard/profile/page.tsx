import { redirect } from 'next/navigation';
import { getOwnLegacyProfileReviewData, getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { ProfileForm } from './profile-form';
import { getUser } from '@/lib/db/queries';

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ confirmDetails?: string }> }) {
  const user = await getUser();
  if (!user || user.accountState === 'onboarding') redirect('/dashboard');
  const actor = await requireAccountAccess(user.legacyProfileReviewRequired ? 'profile_review' : 'profile');
  const privileged = isPrivilegedActor(actor);
  const member = user.legacyProfileReviewRequired ? await getOwnLegacyProfileReviewData() : await getOwnPrivateMember();
  // An administrator/super_admin is never a member and must never be gated by membership payment
  // status or pushed into onboarding for lacking a member profile -- they just see the account
  // email field alone, no profile section.
  if (!member && !privileged) redirect('/dashboard');
  if (member && !privileged && !user.legacyProfileReviewRequired && !isEntitled((member as NonNullable<Awaited<ReturnType<typeof getOwnPrivateMember>>>).entitlement, new Date().toISOString().slice(0, 10))) redirect('/dashboard');
  const { confirmDetails } = await searchParams;
  return (
    <section className="py-4 lg:py-8 px-5 lg:px-8">
      <h1 className="text-2xl font-medium">My Profile</h1>
      {user.legacyProfileReviewRequired || confirmDetails ? (
        <p className="mt-6 rounded-md border border-gold/30 bg-gold/10 p-4 text-sm text-gold">
          Before continuing, review every official profile field below, correct anything out of date, fill in missing information, and save once to confirm your details.
        </p>
      ) : null}
      <ProfileForm email={user.emailDisplay ?? user.email} member={member} />
    </section>
  );
}
