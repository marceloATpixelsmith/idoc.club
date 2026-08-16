import Link from 'next/link';
import { listNotificationHistory, requireAccountAccess, searchMembersForAdmin } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

const KIND_LABELS: Record<string, string> = {
  'administrator.profile_changed': 'Profile changed (admin alert)',
  'membership.expiration_reminder': 'Expiration reminder',
  'membership.grace_expired': 'Grace period ended',
  'membership.grace_reminder': 'Grace period reminder',
  'membership.payment_failed': 'Payment failed / grace started',
  'membership.renewal_reminder': 'Renewal reminder',
  'stripe.customer_email_sync': 'Stripe email sync',
};

function outcome(row: { deadLetteredAt: Date | null; lastErrorCode: string | null; sentAt: Date | null }): string {
  if (row.sentAt) return 'Delivered';
  if (row.deadLetteredAt) return 'Failed (gave up)';
  if (row.lastErrorCode) return 'Retrying';
  return 'Pending';
}

export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<{ profileId?: string; q?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const { profileId: profileIdParam, q } = await searchParams;
  const query = q ?? '';
  const results = query ? await searchMembersForAdmin(query) : [];
  const profileId = profileIdParam ? Number(profileIdParam) : null;
  const history = profileId && Number.isInteger(profileId) ? await listNotificationHistory(profileId) : null;

  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">Notification delivery history</h1>
    <form method="get" className="mt-6 flex max-w-md gap-2">
      <input className="block w-full rounded-md border-gray-300" defaultValue={query} name="q" placeholder="Search by name or email" type="text" />
      <button className="rounded-md border px-3 py-1 text-sm" type="submit">Search</button>
    </form>
    {results.length > 0 && (
      <ul className="mt-4 max-w-md divide-y border rounded-md">
        {results.map((member) => (
          <li key={member.profileId} className="p-3 text-sm">
            <Link className="underline" href={`/admin/notifications?q=${encodeURIComponent(query)}&profileId=${member.profileId}`}>
              {member.firstName} {member.lastName} — {member.email}
            </Link>
          </li>
        ))}
      </ul>
    )}
    {history && (
      <section className="mt-8 overflow-x-auto">
        <table className="min-w-full border text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left">
              <th className="p-2">Kind</th>
              <th className="p-2">Created</th>
              <th className="p-2">Sent</th>
              <th className="p-2">Attempts</th>
              <th className="p-2">Last error</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr><td className="p-2 text-gray-500" colSpan={6}>No notifications on file for this member.</td></tr>
            )}
            {history.map((row) => (
              <tr key={row.id} className="border-b">
                <td className="p-2">{KIND_LABELS[row.kind] ?? row.kind}</td>
                <td className="p-2">{row.createdAt.toISOString()}</td>
                <td className="p-2">{row.sentAt ? row.sentAt.toISOString() : '—'}</td>
                <td className="p-2">{row.attemptCount}</td>
                <td className="p-2">{row.lastErrorCode ?? '—'}</td>
                <td className="p-2">{outcome(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    )}
  </main>;
}
