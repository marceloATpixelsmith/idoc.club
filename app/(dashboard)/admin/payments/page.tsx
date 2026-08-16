import Link from 'next/link';
import { getPrivateMember, requireAccountAccess, searchMembersForAdmin } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { ManualPaymentForm } from './manual-payment-form';

const STATUS_LABELS: Record<string, string> = {
  active: 'Active', canceled: 'Canceled', complimentary: 'Complimentary',
  expired: 'Expired', grace: 'Payment grace period', review_required: 'Under review', suspended: 'Suspended',
};

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ profileId?: string; q?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const { profileId: profileIdParam, q } = await searchParams;
  const query = q ?? '';
  const results = query ? await searchMembersForAdmin(query) : [];
  const profileId = profileIdParam ? Number(profileIdParam) : null;
  const selected = profileId && Number.isInteger(profileId) ? await getPrivateMember(profileId) : null;

  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">Record a manual payment</h1>
    <form method="get" className="mt-6 flex max-w-md gap-2">
      <input className="block w-full rounded-md border-gray-300" defaultValue={query} name="q" placeholder="Search by name or email" type="text" />
      <button className="rounded-md border px-3 py-1 text-sm" type="submit">Search</button>
    </form>
    {results.length > 0 && (
      <ul className="mt-4 max-w-md divide-y border rounded-md">
        {results.map((member) => (
          <li key={member.profileId} className="p-3 text-sm">
            <Link className="underline" href={`/admin/payments?q=${encodeURIComponent(query)}&profileId=${member.profileId}`}>
              {member.firstName} {member.lastName} — {member.email}
            </Link>
          </li>
        ))}
      </ul>
    )}
    {selected && (
      <section className="mt-8 max-w-md border rounded-lg p-4">
        <h2 className="font-medium text-gray-900">{selected.profile.firstName} {selected.profile.lastName}</h2>
        <p className="mt-1 text-sm text-gray-700">
          Status: {selected.entitlement ? (STATUS_LABELS[selected.entitlement.status] ?? selected.entitlement.status) : 'No membership on file'}
        </p>
        {selected.entitlement && <p className="text-sm text-gray-700">Paid through: {selected.entitlement.validUntil}</p>}
        <ManualPaymentForm currentValidUntil={selected.entitlement?.validUntil ?? null} profileId={selected.profile.id} />
      </section>
    )}
  </main>;
}
