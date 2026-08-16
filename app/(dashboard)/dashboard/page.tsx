import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';

const STATUS_LABELS: Record<string, string> = {
  active: 'Active', canceled: 'Canceled', complimentary: 'Complimentary',
  expired: 'Expired', grace: 'Payment grace period', review_required: 'Under review', suspended: 'Suspended',
};

export default async function DashboardPage() {
  await requireAccountAccess('member');
  const member = await getOwnPrivateMember();
  if (!member) redirect('/onboarding');
  const { entitlement } = member;
  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">IDOC member account</h1>
    <p className="mt-3">Welcome, {member.profile.firstName} {member.profile.lastName}.</p>
    <p className="mt-2">Your professional profile contains {member.roles.length} active classification record(s).</p>
    <section className="mt-6 border rounded-lg p-4 max-w-md">
      <h2 className="font-medium text-gray-900">Membership</h2>
      {entitlement ? (
        <>
          <p className="mt-2 text-sm text-gray-700">Status: {STATUS_LABELS[entitlement.status] ?? entitlement.status}</p>
          <p className="mt-1 text-sm text-gray-700">Paid through: {entitlement.validUntil}</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-700">No membership on file yet.</p>
      )}
      <Link className="mt-3 inline-block underline text-sm" href="/pricing">
        {entitlement ? 'Renew or manage payment' : 'Start your membership'}
      </Link>
    </section>
    <Link className="mt-6 inline-block underline" href="/dashboard/general">Manage account</Link>
  </main>;
}
