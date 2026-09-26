import { getPrivateMember, listAdminPaymentHistory, listAuditHistory, listNotificationHistory, requireAccountAccess } from '@/lib/membership/data-access';
import { listAdminMembers, MemberFilterRangeError, type MemberFilters } from '@/lib/membership/admin-memberships';
import { requireAdministrator } from '@/lib/membership/authorization';
import { listActiveRoles } from '@/lib/membership/role-grants';
import { getUserAccountState } from '@/lib/membership/account-suspension';
import { listAdminSeminarHistoryForMember } from '@/lib/seminars/registrations';
import { MembersTable } from './members-table';
import { MemberDetailSheet } from './member-detail-sheet';
import { getTablePreferences } from '@/lib/admin/table-preferences';
import { client } from '@/lib/db/drizzle';

export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<{ profileId?: string; tab?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const isSuperAdmin = actor.roles.includes('super_admin');
  const { profileId: profileIdParam, tab } = await searchParams;
  // Filters, sort, columns, and pagination all come from the database, never the URL -- see
  // components/admin/table-preference-sync.tsx and docs/07 for why. `profileId` is the one
  // deliberate exception: opening a specific member's detail panel is exactly the short-lived,
  // single-step use of a query param this app still allows.
  const savedPreferences = await getTablePreferences('memberships');
  const visibleColumns = Array.isArray(savedPreferences?.columns) ? savedPreferences.columns : undefined;
  const listParams: MemberFilters = {
    country: typeof savedPreferences?.country === 'string' ? savedPreferences.country : undefined,
    expiresFrom: typeof savedPreferences?.expiresFrom === 'string' ? savedPreferences.expiresFrom : undefined,
    expiresTo: typeof savedPreferences?.expiresTo === 'string' ? savedPreferences.expiresTo : undefined,
    federation: typeof savedPreferences?.federation === 'string' ? savedPreferences.federation : undefined,
    page: typeof savedPreferences?.page === 'number' ? savedPreferences.page : undefined,
    pageSize: typeof savedPreferences?.pageSize === 'number' ? savedPreferences.pageSize : undefined,
    q: typeof savedPreferences?.q === 'string' ? savedPreferences.q : undefined,
    region: typeof savedPreferences?.region === 'string' ? savedPreferences.region : undefined,
    sort: typeof savedPreferences?.sort === 'string' ? savedPreferences.sort : undefined,
    status: typeof savedPreferences?.status === 'string' ? savedPreferences.status : undefined,
    type: typeof savedPreferences?.type === 'string' ? savedPreferences.type : undefined,
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
  // getPrivateMember and listAuditHistory both depend only on profileId, not on each other; once
  // `selected` resolves, the remaining four detail-panel queries depend only on `selected`, not on
  // each other either. Six round trips to the database run one at a time here previously (~6x the
  // latency of a single query), which is the dominant cost in this route's render time whenever a
  // member's profile is open -- Promise.all lets them overlap instead.
  const [selected, auditHistory] = await Promise.all([
    hasValidProfileId ? getPrivateMember(profileId!) : Promise.resolve(null),
    hasValidProfileId ? listAuditHistory(profileId!) : Promise.resolve([]),
  ]);
  const [activeRoles, accountState, paymentHistory, seminarHistory, notificationHistory] = await Promise.all([
    selected && isSuperAdmin ? listActiveRoles(selected.profile.userId) : Promise.resolve([]),
    selected ? getUserAccountState(selected.profile.userId) : Promise.resolve(null),
    selected ? listAdminPaymentHistory(selected.profile.id) : Promise.resolve([]),
    selected ? listAdminSeminarHistoryForMember(selected.profile.id) : Promise.resolve([]),
    selected ? listNotificationHistory(selected.profile.id) : Promise.resolve([]),
  ]);
  // Same query the standalone /admin/payments page used to run -- now feeding the Sheet's Payment
  // tab instead of a separate route (see components/admin-navigation.tsx: that nav item just told
  // admins to go back to Members and search, so it's gone).
  const stripePayments = selected ? await client<{ amount_cents: number; currency: string; id: number; paid_at: Date | string; refund_status: string | null; source: string }[]>`select p.id,p.source,p.amount_cents,p.currency,p.paid_at,
    (select status from idoc.payment_refunds r where r.membership_payment_id=p.id order by r.requested_at desc limit 1) refund_status
    from idoc.payments p where p.profile_id=${selected.profile.id} and p.source in ('stripe_recurring','stripe_one_time') order by p.paid_at desc` : [];

  return <main className="flex-1 py-8 px-5 lg:px-8">
    <h1 className="text-2xl font-semibold">Members</h1>
    {filterError && <p className="mt-4 rounded-md border border-red-500 p-3 text-sm text-red-600" role="alert">{filterError}</p>}
    <MembersTable initialColumnOrder={typeof savedPreferences?.columnOrder === 'string' ? savedPreferences.columnOrder : undefined} initialVisibleColumns={visibleColumns} filters={listing.filters} pageSize={listing.pageSize} rows={listing.rows} total={listing.total} />
    {selected && (
      <MemberDetailSheet
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
