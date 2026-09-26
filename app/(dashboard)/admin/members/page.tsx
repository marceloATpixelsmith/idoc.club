import Link from 'next/link';
import { getPrivateMember, listAdminPaymentHistory, listAuditHistory, requireAccountAccess } from '@/lib/membership/data-access';
import { listAdminMembers, MemberFilterRangeError, type MemberFilters } from '@/lib/membership/admin-memberships';
import { requireAdministrator } from '@/lib/membership/authorization';
import { listActiveRoles } from '@/lib/membership/role-grants';
import { getUserAccountState } from '@/lib/membership/account-suspension';
import { MEMBERSHIP_STATUS_LABELS } from '@/lib/membership/entitlement';
import { AdminProfileForm } from './admin-profile-form';
import { EntitlementCorrectionForm } from './entitlement-correction-form';
import { ReinstateForm, SuspendForm } from './membership-status-form';
import { ForceRevokeAllAuthorityForm, ReinstateAccountForm, SuspendAccountForm } from './account-suspension-form';
import { RolesSection } from './roles-section';
import { listAdminSeminarHistoryForMember } from '@/lib/seminars/registrations';
import { MembersTable } from './members-table';
import { ExtendExpirationForm } from './extend-expiration-form';
import { getTablePreferences } from '@/lib/admin/table-preferences';

const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer', cash: 'Cash', complimentary: 'Complimentary grant',
  paypal: 'PayPal', stripe_one_time: 'Stripe one-time', stripe_recurring: 'Stripe recurring',
};

function money(amountCents: number, currency: string) {
  return new Intl.NumberFormat('en', { currency, style: 'currency' }).format(amountCents / 100);
}

export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<{ profileId?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const isSuperAdmin = actor.roles.includes('super_admin');
  const { profileId: profileIdParam } = await searchParams;
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
  const [activeRoles, accountState, paymentHistory, seminarHistory] = await Promise.all([
    selected && isSuperAdmin ? listActiveRoles(selected.profile.userId) : Promise.resolve([]),
    selected ? getUserAccountState(selected.profile.userId) : Promise.resolve(null),
    selected ? listAdminPaymentHistory(selected.profile.id) : Promise.resolve([]),
    selected ? listAdminSeminarHistoryForMember(selected.profile.id) : Promise.resolve([]),
  ]);

  return <main className="flex-1 py-8 px-5 lg:px-8">
    <h1 className="text-2xl font-semibold">Members</h1>
    {filterError && <p className="mt-4 rounded-md border border-red-500 p-3 text-sm text-red-600" role="alert">{filterError}</p>}
    <MembersTable initialColumnOrder={typeof savedPreferences?.columnOrder === 'string' ? savedPreferences.columnOrder : undefined} initialVisibleColumns={visibleColumns} filters={listing.filters} pageSize={listing.pageSize} rows={listing.rows} total={listing.total} />
    {selected && (
      <>
        <section className="mt-8 max-w-2xl border rounded-lg p-4">
          <h2 className="font-medium text-foreground">{selected.profile.firstName} {selected.profile.lastName}</h2>
          <p className="mt-1 text-sm text-foreground">
            Status: {selected.entitlement ? (MEMBERSHIP_STATUS_LABELS[selected.entitlement.status] ?? selected.entitlement.status) : 'No membership on file'}
          </p>
          {selected.entitlement && <p className="text-sm text-foreground">Paid through: {selected.entitlement.validUntil}</p>}
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <a className="text-primary underline underline-offset-4 hover:opacity-80" href="#payment-history">View Payment History</a>
            <Link className="text-primary underline underline-offset-4 hover:opacity-80" href={`/admin/payments?profileId=${selected.profile.id}`}>Record Manual Payment</Link>
            {selected.entitlement && <a className="text-primary underline underline-offset-4 hover:opacity-80" href="#extend-expiration">Extend Expiration Date</a>}
            <a className="text-primary underline underline-offset-4 hover:opacity-80" href="#edit-member">Edit Member Information</a>
            <a className="text-primary underline underline-offset-4 hover:opacity-80" href="#edit-member">Change Membership Type</a>
            <a className="text-primary underline underline-offset-4 hover:opacity-80" href={`mailto:${encodeURIComponent(selected.email)}`}>Email Member</a>
            <a className="text-primary underline underline-offset-4 hover:opacity-80" href="#seminar-history">View Seminars</a>
            <Link className="text-primary underline underline-offset-4 hover:opacity-80" href={`/admin/notifications?profileId=${selected.profile.id}`}>Notification history</Link>
          </div>
        </section>

        <section className="mt-8 max-w-2xl" id="seminar-history">
          <h3 className="font-bold uppercase tracking-wider text-gold">Seminar history</h3>
          <div className="mt-2 overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Seminar</th><th className="p-2 text-left">Date</th><th className="p-2 text-left">Registration</th><th className="p-2 text-left">Payment</th><th className="p-2 text-left">Seminar status</th><th className="p-2 text-left">Location</th></tr></thead><tbody>
            {seminarHistory.length === 0 ? <tr><td className="p-4 text-muted-foreground" colSpan={6}>No seminar history is associated with this member.</td></tr> : seminarHistory.map((seminar) => <tr className="border-t" key={seminar.id}><td className="p-2">{seminar.title}</td><td className="p-2">{seminar.seminarDate}</td><td className="p-2">{seminar.registrationStatus}</td><td className="p-2">{seminar.paymentStatus}</td><td className="p-2">{seminar.seminarStatus}</td><td className="p-2">{seminar.location}</td></tr>)}
          </tbody></table></div>
        </section>

        <section className="mt-8 max-w-2xl" id="payment-history">
          <h3 className="font-bold uppercase tracking-wider text-gold">Payment History</h3>
          <div className="mt-2 overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Payment date</th><th className="p-2 text-left">Amount</th><th className="p-2 text-left">Source</th><th className="p-2 text-left">Origin</th><th className="p-2 text-left">Reference</th></tr></thead><tbody>
            {paymentHistory.length === 0 ? <tr><td className="p-4 text-muted-foreground" colSpan={5}>No payments have been recorded for this member.</td></tr> : paymentHistory.map((payment, index) => <tr className="border-t" key={`${payment.paidAt.toISOString()}-${index}`}><td className="p-2">{payment.paidAt.toISOString()}</td><td className="p-2">{money(payment.amountCents, payment.currency)}</td><td className="p-2">{PAYMENT_SOURCE_LABELS[payment.source] ?? payment.source}</td><td className="p-2">{payment.source.startsWith('stripe_') ? 'Stripe' : 'Manual'}</td><td className="p-2">{payment.reference ?? '—'}</td></tr>)}
          </tbody></table></div>
        </section>

        {selected.entitlement && <section className="mt-8 max-w-2xl" id="extend-expiration"><h3 className="font-bold uppercase tracking-wider text-gold">Extend Expiration Date</h3><p className="mt-1 text-sm text-muted-foreground">Extension only: this does not add a payment or change Stripe billing dates. Use Correct entitlement below for a genuine correction.</p><ExtendExpirationForm currentValidUntil={selected.entitlement.validUntil} profileId={selected.profile.id} /></section>}

        <section className="mt-8 max-w-2xl">
          <h3 className="font-bold uppercase tracking-wider text-gold">Membership status</h3>
          {selected.entitlement?.status === 'suspended'
            ? <ReinstateForm profileId={selected.profile.id} />
            : selected.entitlement
              ? <SuspendForm profileId={selected.profile.id} />
              : <p className="mt-2 text-sm text-muted-foreground">No membership on file — nothing to suspend.</p>}
        </section>

        <section className="mt-8 max-w-2xl">
          <h3 className="font-bold uppercase tracking-wider text-gold">Account authentication</h3>
          <p className="mt-1 text-sm text-muted-foreground">Distinct from membership status above: this controls whether the user can sign in at all.</p>
          {accountState === 'suspended'
            ? <ReinstateAccountForm userId={selected.profile.userId} />
            : <SuspendAccountForm userId={selected.profile.userId} />}
        </section>

        <section className="mt-8 max-w-2xl">
          <h3 className="font-bold uppercase tracking-wider text-gold">Correct entitlement</h3>
          <EntitlementCorrectionForm currentValidUntil={selected.entitlement?.validUntil ?? null} profileId={selected.profile.id} />
        </section>

        <section className="mt-8 max-w-2xl" id="edit-member">
          <h3 className="font-bold uppercase tracking-wider text-gold">Edit Member Information / Change Membership Type</h3>
          <p className="mt-1 text-sm text-muted-foreground">Membership type changes preserve role history and do not change expiration, payments, or Stripe billing.</p>
          <AdminProfileForm member={selected} profileId={selected.profile.id} />
        </section>

        {isSuperAdmin && (
          <section className="mt-8 max-w-2xl">
            <h3 className="font-bold uppercase tracking-wider text-gold">Application roles</h3>
            <RolesSection activeRoles={activeRoles} userId={selected.profile.userId} />
          </section>
        )}

        {isSuperAdmin && (
          <section className="mt-8 max-w-2xl">
            <h3 className="font-bold uppercase tracking-wider text-gold">Incident response</h3>
            <ForceRevokeAllAuthorityForm userId={selected.profile.userId} />
          </section>
        )}

        <section className="mt-8 max-w-2xl">
          <h3 className="font-bold uppercase tracking-wider text-gold">Audit trail</h3>
          <table className="mt-2 min-w-full border text-sm">
            <thead>
              <tr className="border-b bg-surface text-left">
                <th className="p-2">Action</th>
                <th className="p-2">When</th>
                <th className="p-2">Reason</th>
                <th className="p-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {auditHistory.length === 0 && (
                <tr><td className="p-2 text-muted-foreground" colSpan={4}>No audit entries for this member.</td></tr>
              )}
              {auditHistory.map((entry) => (
                <tr key={entry.id} className="border-b align-top">
                  <td className="p-2">{entry.action}</td>
                  <td className="p-2">{entry.createdAt.toISOString()}</td>
                  <td className="p-2">{entry.reason ?? '—'}</td>
                  <td className="p-2">
                    <details>
                      <summary className="cursor-pointer underline">View</summary>
                      <pre className="mt-1 max-w-md overflow-x-auto text-xs">{JSON.stringify({ after: entry.afterJson, before: entry.beforeJson }, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </>
    )}
  </main>;
}
