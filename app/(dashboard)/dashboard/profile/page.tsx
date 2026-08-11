import { redirect } from 'next/navigation';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { ProfileForm } from './profile-form';

export default async function ProfilePage() {
  const member = await getOwnPrivateMember();
  if (!member) redirect('/onboarding');
  return <section className="p-4 lg:p-8"><h1 className="mb-6 text-2xl font-medium">Member profile</h1><ProfileForm member={member} /></section>;
}
