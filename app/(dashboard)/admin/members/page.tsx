import { getPrivateMember, listAdminPaymentHistory, listAuditHistory, listNotificationHistory, requireAccountAccess } from '@/lib/membership/data-access';
import { listAdminMembers, MemberFilterRangeError, type MemberFilters } from '@/lib/membership/admin-memberships';
import { requireAdministrator } from '@/lib/membership/authorization';
import { listActiveRoles } from '@/lib/membership/role-grants';
import { getUserAccountState } from '@/lib/membership/account-suspension';
import { listAdminSeminarHistoryForMember } from '@/lib/seminars/registrations';
import { MembersTable } from './members-table';
import { MemberTimelineDrawer } from './member-timeline-drawer';
import { MemberDetailSheet } from './member-detail-sheet';
import { getTablePreferences } from '@/lib/admin/table-preferences';
import { client } from '@/lib/db/drizzle';
import type { ReadOnlyRow } from '@/components/admin/admin-read-only-table';

const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  'administrator.profile_changed': 'Profile changed (admin alert)',
  'membership.expiration_reminder': 'Expiration reminder',
  'membership.grace_expired': 'Grace period ended',
  'membership.grace_reminder': 'Grace period reminder',
  'membership.payment_failed': 'Payment failed / grace started',
  'membership.renewal_reminder': 'Renewal reminder',
  'stripe.customer_email_sync': 'Stripe email sync',
};

function notificationOutcome(row: { deadLetteredAt: Date | null; lastErrorCode: string | null; sentAt: Date | null }): string {
  if (row.sentAt) return 'Delivered';
  if (row.deadLetteredAt) return 'Failed (gave up)';
  if (row.lastErrorCode) return 'Retrying';
  return 'Pending';
}

export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<{ profileId?: string; tab?: string; timeline?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const isSuperAdmin = actor.roles.includes('super_admin');
  const { profileId: profileIdParam, tab, timeline: timelineParam } = await searchParams;
  const timelineProfileId = timelineParam && /^\d{1,10}$/.test(timelineParam) ? Number(timelineParam) : null;
  // The Member timeline drawer keeps its filters per administrator, like every table (never in the URL).
  const timelinePreferences = timelineProfileId ? await getTablePreferences('member_timeline') : null;
  // Filters, sort, columns, and pagination all come from the database, never the URL -- see
  // components/admin/table-preference-sync.tsx and docs/07 for why. `profileId` is the one
  // deliberate exception: opening a specific member's detail panel is exactly the short-lived,
  // single-step use of a query param this app still allows.
  const savedPreferences = await getTablePreferences('memberships');
  const visibleColumns = Array.isArray(savedPreferences?.columns) ? savedPreferences.columns : undefined;
  const listParams: MemberFilters = {
    expiresFrom: typeof savedPreferences?.expiresFrom === 'string' ? savedPreferences.expiresFrom : undefined,
    expiresTo: typeof savedPreferences?.expiresTo === 'string' ? savedPreferences.expiresTo : undefined,
    federation: typeof savedPreferences?.federation === 'string' ? savedPreferences.federation : undefined,
    page: typeof savedPreferences?.page === 'number' ? savedPreferences.page : undefined,
    pageSize: typeof savedPreferences?.pageSize === 'number' ? savedPreferences.pageSize : undefined,
    q: typeof savedPreferences?.q === 'string' ? savedPreferences.q : undefined,
    region: typeof savedPreferences?.region === 'string' ? savedPreferences.region : undefined,
    sort: typeof savedPreferences?.sort === 'string' ? savedPreferences.sort : undefined,
    // `savedPreferences === null` means this administrator has never saved a preference for this
    // table at all (not merely "status happens to be absent", which is also true right after
    // clicking Reset) -- only that true first-ever case gets the documented active-by-default view;
    // Reset must be able to actually clear Status to "no restriction", not just re-apply this.
    status: typeof savedPreferences?.status === 'string' ? savedPreferences.status : savedPreferences === null ? 'active' : undefined,
    type: typeof savedPreferences?.type === 'string' ? savedPreferences.type : undefined,
    officialStatus: typeof savedPreferences?.officialStatus === 'string' ? savedPreferences.officialStatus : undefined,
  };
  let filterError: string | null = null;
  let listing: Awaited<ReturnType<typeof listAdminMembers>>;
  try {
    listing = await listAdminMembers(listParams);
  } catch (error) {
    if (!(error instanceof MemberFilterRangeError)) throw error;
    filterError = error.message;
    listing = await listAdminMembers({ status: 'active' });
  }
  const profileId = profileIdParam ? Number(profileIdParam) : null;
  const hasValidProfileId = Boolean(profileId && Number.isInteger(profileId));
  // getPrivateMember, listAuditHistory and the Stripe payment query all depend only on profileId (the
  // payment query filters on the same profile id `selected.profile.id` resolves to), not on each other;
  // once `selected` resolves, the remaining detail-panel queries depend only on `selected`, not on each
  // other either. Running them one at a time costs ~one database round trip each, which is the dominant
  // cost in this route's render time whenever a member's profile is open -- Promise.all lets them overlap.
  // The payment query is the same one the standalone /admin/payments page used to run -- now feeding the
  // Sheet's Payment tab instead of a separate route (see components/admin-navigation.tsx).
  const [selected, auditHistory, stripePayments] = await Promise.all([
    hasValidProfileId ? getPrivateMember(profileId!) : Promise.resolve(null),
    hasValidProfileId ? listAuditHistory(profileId!) : Promise.resolve([]),
    hasValidProfileId ? client<{ amount_cents: number; currency: string; id: number; paid_at: Date | string; refund_status: string | null; source: string }[]>`select p.id,p.source,p.amount_cents,p.currency,p.paid_at,
      (select status from payment_refunds r where r.membership_payment_id=p.id order by r.requested_at desc limit 1) refund_status
      from payments p where p.profile_id=${profileId!} and p.source in ('stripe_recurring','stripe_one_time') order by p.paid_at desc` : Promise.resolve([]),
  ]);
  const [activeRoles, accountState, paymentHistory, seminarHistory, rawNotificationHistory] = await Promise.all([
    selected && isSuperAdmin ? listActiveRoles(selected.profile.userId) : Promise.resolve([]),
    selected ? getUserAccountState(selected.profile.userId) : Promise.resolve(null),
    selected ? listAdminPaymentHistory(selected.profile.id) : Promise.resolve([]),
    selected ? listAdminSeminarHistoryForMember(selected.profile.id) : Promise.resolve([]),
    selected ? listNotificationHistory(selected.profile.id) : Promise.resolve([]),
  ]);
  // listNotificationHistory selects every column (payload, dedupeKey, leaseOwner, lease timestamps
  // included) since it also backs the durable-outbox worker; project down to only the fields the
  // Sheet's Notifications tab displays before this crosses into the client component, exactly like
  // the standalone /admin/notifications page always did.
  const notificationHistory: ReadOnlyRow[] = rawNotificationHistory.map((row) => ({
    id: String(row.id), kind: NOTIFICATION_KIND_LABELS[row.kind] ?? row.kind,
    created: row.createdAt.toISOString(), sent: row.sentAt ? row.sentAt.toISOString() : '—',
    attempts: String(row.attemptCount), lastError: row.lastErrorCode ?? '—', status: notificationOutcome(row),
  }));
  return <main className="flex-1 py-8 px-5 lg:px-8">
    <h1 className="text-3xl font-semibold text-gold">Members</h1>
    {filterError && <p className="mt-4 rounded-md border border-red-500 p-3 text-sm text-red-600" role="alert">{filterError}</p>}
    <MembersTable initialColumnOrder={typeof savedPreferences?.columnOrder === 'string' ? savedPreferences.columnOrder : undefined} initialVisibleColumns={visibleColumns} filters={listing.filters} pageSize={listing.pageSize} rows={listing.rows} total={listing.total} />
    {timelineProfileId ? <MemberTimelineDrawer initialPreferences={timelinePreferences} key={`timeline-${timelineProfileId}`} profileId={timelineProfileId} /> : null}
    {selected && (
      <MemberDetailSheet
        key={selected.profile.id}
        accountState={accountState}
        activeRoles={activeRoles}
        auditHistory={auditHistory}
        closeHref="/admin/members"
        initialTab={tab}
        isSuperAdmin={isSuperAdmin}
        notificationHistory={notificationHistory}
        paymentHistory={paymentHistory}
        seminarHistory={seminarHistory}
        selected={selected}
        stripePayments={stripePayments}
      />
    )}
  </main>;
}
