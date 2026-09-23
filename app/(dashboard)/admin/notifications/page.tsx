import Link from 'next/link';
import { AdminReadOnlyTable } from '@/components/admin/admin-read-only-table';
import { listNotificationHistory, requireAccountAccess } from '@/lib/membership/data-access';
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

export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<{ profileId?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const { profileId: profileIdParam } = await searchParams;
  const profileId = profileIdParam ? Number(profileIdParam) : null;
  const history = profileId && Number.isInteger(profileId) ? await listNotificationHistory(profileId) : null;

  return <main className="flex-1 py-8 px-5 lg:px-8">
    <h1 className="text-2xl font-semibold">Notification delivery history</h1>
    <Link className="mt-2 inline-block underline text-sm" href="/admin/members">← Search members</Link>
    {!history && <p className="mt-4 text-sm text-foreground">Search for a member on the <Link className="text-primary underline underline-offset-4 hover:opacity-80" href="/admin/members">Members page</Link> to view their notification history.</p>}
    {history && <section className="mt-8">
      <AdminReadOnlyTable
        key={profileId}
        columns={[{ id: 'kind', label: 'Kind' }, { id: 'created', label: 'Created' }, { id: 'sent', label: 'Sent' }, { id: 'attempts', label: 'Attempts' }, { id: 'lastError', label: 'Last error' }, { id: 'status', label: 'Status' }]}
        empty="No notifications on file for this member."
        rows={history.map((row) => ({
          id: String(row.id), kind: KIND_LABELS[row.kind] ?? row.kind,
          created: row.createdAt.toISOString(), sent: row.sentAt ? row.sentAt.toISOString() : '—',
          attempts: String(row.attemptCount), lastError: row.lastErrorCode ?? '—', status: outcome(row),
        }))}
        searchLabel="Search notification history"
        statusColumn="status"
        tableType="notifications"
      />
    </section>}
  </main>;
}
