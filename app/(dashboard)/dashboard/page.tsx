import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';

export default async function DashboardPage() {
  await requireAccountAccess('member');
  const member = await getOwnPrivateMember();
  if (!member) redirect('/onboarding');
  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">IDOC member account</h1>
    <p className="mt-3">Welcome, {member.profile.firstName} {member.profile.lastName}.</p>
    <p className="mt-2">Your professional profile contains {member.roles.length} active classification record(s).</p>
    <Link className="mt-6 inline-block underline" href="/dashboard/general">Manage account</Link>
  </main>;
}
