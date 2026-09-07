import Link from 'next/link';
import { getPrivateMember, listAdminPaymentHistory, listAuditHistory, requireAccountAccess } from '@/lib/membership/data-access';
import { listAdminMembers, type MemberFilters, MEMBERSHIP_STATUSES } from '@/lib/membership/admin-memberships';
import { requireAdministrator } from '@/lib/membership/authorization';
import { listActiveRoles } from '@/lib/membership/role-grants';
import { getUserAccountState } from '@/lib/membership/account-suspension';
import { MEMBERSHIP_STATUS_LABELS } from '@/lib/membership/entitlement';
import { AdminProfileForm } from './admin-profile-form';
import { EntitlementCorrectionForm } from './entitlement-correction-form';
import { ReinstateForm, SuspendForm } from './membership-status-form';
import { ForceRevokeAllAuthorityForm, ReinstateAccountForm, SuspendAccountForm } from './account-suspension-form';
import { RolesSection } from './roles-section';
import { BulkMemberSelection } from './bulk-member-selection';
import { ExtendExpirationForm } from './extend-expiration-form';

const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer', cash: 'Cash', complimentary: 'Complimentary grant',
  paypal: 'PayPal', stripe_one_time: 'Stripe one-time', stripe_recurring: 'Stripe recurring',
};

function money(amountCents: number, currency: string) {
  return new Intl.NumberFormat('en', { currency, style: 'currency' }).format(amountCents / 100);
}

export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<MemberFilters & { profileId?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const isSuperAdmin = actor.roles.includes('super_admin');
  const params = await searchParams;
  const { profileId: profileIdParam } = params;
  const listing = await listAdminMembers(params);
  const paginationHref = (page: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(listing.filters)) {
      if (key !== 'page' && value !== undefined && value !== '') query.set(key, String(value));
    }
    query.set('page', String(page));
    return `?${query}`;
  };
  const profileId = profileIdParam ? Number(profileIdParam) : null;
  const selected = profileId && Number.isInteger(profileId) ? await getPrivateMember(profileId) : null;
  const auditHistory = profileId && Number.isInteger(profileId) ? await listAuditHistory(profileId) : [];
  const activeRoles = selected && isSuperAdmin ? await listActiveRoles(selected.profile.userId) : [];
  const accountState = selected ? await getUserAccountState(selected.profile.userId) : null;
  const paymentHistory = selected ? await listAdminPaymentHistory(selected.profile.id) : [];

  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">Members</h1>
    <nav className="mt-4 flex gap-4 text-sm" aria-label="Membership views"><Link className="underline" href="/admin/members?status=active">Active</Link><Link className="underline" href="/admin/members?status=expired">Expired</Link><Link className="underline" href="/admin/members?status=archived">Archived</Link><Link className="underline" href="/admin/revenue">Revenue dashboard</Link></nav>
    <p className="mt-3 text-sm">Applied status filter: <strong>{listing.filters.status}</strong>{!params.status && ' (default)'}</p>
    <form method="get" className="mt-4 grid gap-3 rounded-lg border p-4 md:grid-cols-4">
      <label className="text-sm md:col-span-2">Name or email<input className="block w-full rounded-md border" defaultValue={listing.filters.q} name="q" type="search" /></label>
      <label className="text-sm">Status<select className="block w-full rounded-md border" defaultValue={listing.filters.status} name="status">{MEMBERSHIP_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
      <label className="text-sm">Membership type<select className="block w-full rounded-md border" defaultValue={listing.filters.membershipType ?? ''} name="membershipType"><option value="">All</option><option value="judge">Judge</option><option value="steward">Steward</option><option value="combo">J&amp;S Combo</option><option value="veterinarian">Veterinarian</option></select></label>
      <label className="text-sm">Expires from<input className="block w-full rounded-md border" defaultValue={listing.filters.expiresFrom} name="expiresFrom" type="date" /></label>
      <label className="text-sm">Expires through<input className="block w-full rounded-md border" defaultValue={listing.filters.expiresTo} name="expiresTo" type="date" /></label>
      <label className="text-sm">Federation<input className="block w-full rounded-md border" defaultValue={listing.filters.federation} maxLength={2} name="federation" /></label>
      <label className="text-sm">Country<input className="block w-full rounded-md border" defaultValue={listing.filters.country} maxLength={2} name="country" /></label>
      <label className="text-sm">IDOC Region<input className="block w-full rounded-md border" defaultValue={listing.filters.region} name="region" /></label>
      <label className="text-sm">Sort<select className="block w-full rounded-md border" defaultValue={listing.filters.sort} name="sort"><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option><option value="expires_asc">Expiration earliest</option><option value="expires_desc">Expiration latest</option></select></label>
      <button className="self-end rounded-md border px-3 py-2 text-sm" type="submit">Apply filters</button>
    </form>
    <div className="mt-4 flex items-center justify-between text-sm"><span>{listing.total} matching members</span><Link className="underline" href={`/api/admin/export/members?${new URLSearchParams(Object.entries(params).filter(([,value]) => value !== undefined).map(([key,value]) => [key,String(value)]))}`}>Export filtered CSV</Link></div>
    <div className="mt-2 overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Select</th><th className="p-2 text-left">Member</th><th className="p-2 text-left">Status</th><th className="p-2 text-left">Expires</th><th className="p-2 text-left">Type</th><th className="p-2 text-left">Country</th></tr></thead><tbody>{listing.rows.length === 0 ? <tr><td className="p-4" colSpan={6}>No members match these filters.</td></tr> : listing.rows.map((member) => <tr className="border-t" key={member.profileId}><td className="p-2"><input aria-label={`Select ${member.firstName} ${member.lastName}`} form="bulk-member-actions" name="profileId" type="checkbox" value={member.profileId} /></td><td className="p-2"><Link className="underline" href={`/admin/members?profileId=${member.profileId}&status=${listing.filters.status}`}>{member.firstName} {member.lastName}</Link><span className="block text-muted-foreground">{member.email}</span></td><td className="p-2">{member.status}</td><td className="p-2">{member.validUntil ?? '—'}</td><td className="p-2">{member.membershipType ?? '—'}</td><td className="p-2">{member.country}</td></tr>)}</tbody></table></div>
    <BulkMemberSelection />
    <nav className="mt-4 flex gap-3 text-sm" aria-label="Pagination">{listing.filters.page > 1 && <Link className="underline" href={paginationHref(listing.filters.page - 1)}>Previous</Link>}{listing.filters.page * listing.pageSize < listing.total && <Link className="underline" href={paginationHref(listing.filters.page + 1)}>Next</Link>}</nav>
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
            <a className="text-primary underline underline-offset-4 hover:opacity-80" href="#extend-expiration">Extend Expiration Date</a>
            <a className="text-primary underline underline-offset-4 hover:opacity-80" href="#edit-member">Edit Member Information</a>
            <a className="text-primary underline underline-offset-4 hover:opacity-80" href="#edit-member">Change Membership Type</a>
            <a className="text-primary underline underline-offset-4 hover:opacity-80" href={`mailto:${encodeURIComponent(selected.email)}`}>Email Member</a>
            <span aria-disabled="true" className="text-muted-foreground" title="Seminar registrations are not implemented yet.">View Seminars (unavailable)</span>
            <Link className="text-primary underline underline-offset-4 hover:opacity-80" href={`/admin/notifications?profileId=${selected.profile.id}`}>Notification history</Link>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Seminar registrations are not implemented yet. A future authorized administrator route will show only this member’s registrations.</p>
        </section>

        <section className="mt-8 max-w-2xl" id="payment-history">
          <h3 className="font-medium text-foreground">Payment History</h3>
          <div className="mt-2 overflow-x-auto"><table className="min-w-full border text-sm"><thead><tr><th className="p-2 text-left">Payment date</th><th className="p-2 text-left">Amount</th><th className="p-2 text-left">Source</th><th className="p-2 text-left">Origin</th><th className="p-2 text-left">Reference</th></tr></thead><tbody>
            {paymentHistory.length === 0 ? <tr><td className="p-4 text-muted-foreground" colSpan={5}>No payments have been recorded for this member.</td></tr> : paymentHistory.map((payment, index) => <tr className="border-t" key={`${payment.paidAt.toISOString()}-${index}`}><td className="p-2">{payment.paidAt.toISOString()}</td><td className="p-2">{money(payment.amountCents, payment.currency)}</td><td className="p-2">{PAYMENT_SOURCE_LABELS[payment.source] ?? payment.source}</td><td className="p-2">{payment.source.startsWith('stripe_') ? 'Stripe' : 'Manual'}</td><td className="p-2">{payment.reference ?? '—'}</td></tr>)}
          </tbody></table></div>
        </section>

        {selected.entitlement && <section className="mt-8 max-w-2xl" id="extend-expiration"><h3 className="font-medium text-foreground">Extend Expiration Date</h3><p className="mt-1 text-sm text-muted-foreground">Extension only: this does not add a payment or change Stripe billing dates. Use Correct entitlement below for a genuine correction.</p><ExtendExpirationForm currentValidUntil={selected.entitlement.validUntil} profileId={selected.profile.id} /></section>}

        <section className="mt-8 max-w-2xl">
          <h3 className="font-medium text-foreground">Membership status</h3>
          {selected.entitlement?.status === 'suspended'
            ? <ReinstateForm profileId={selected.profile.id} />
            : selected.entitlement
              ? <SuspendForm profileId={selected.profile.id} />
              : <p className="mt-2 text-sm text-muted-foreground">No membership on file — nothing to suspend.</p>}
        </section>

        <section className="mt-8 max-w-2xl">
          <h3 className="font-medium text-foreground">Account authentication</h3>
          <p className="mt-1 text-sm text-muted-foreground">Distinct from membership status above: this controls whether the user can sign in at all.</p>
          {accountState === 'suspended'
            ? <ReinstateAccountForm userId={selected.profile.userId} />
            : <SuspendAccountForm userId={selected.profile.userId} />}
        </section>

        <section className="mt-8 max-w-2xl">
          <h3 className="font-medium text-foreground">Correct entitlement</h3>
          <EntitlementCorrectionForm currentValidUntil={selected.entitlement?.validUntil ?? null} profileId={selected.profile.id} />
        </section>

        <section className="mt-8 max-w-2xl" id="edit-member">
          <h3 className="font-medium text-foreground">Edit Member Information / Change Membership Type</h3>
          <p className="mt-1 text-sm text-muted-foreground">Membership type changes preserve role history and do not change expiration, payments, or Stripe billing.</p>
          <AdminProfileForm member={selected} profileId={selected.profile.id} />
        </section>

        {isSuperAdmin && (
          <section className="mt-8 max-w-2xl">
            <h3 className="font-medium text-foreground">Application roles</h3>
            <RolesSection activeRoles={activeRoles} userId={selected.profile.userId} />
          </section>
        )}

        {isSuperAdmin && (
          <section className="mt-8 max-w-2xl">
            <h3 className="font-medium text-foreground">Incident response</h3>
            <ForceRevokeAllAuthorityForm userId={selected.profile.userId} />
          </section>
        )}

        <section className="mt-8 max-w-2xl">
          <h3 className="font-medium text-foreground">Audit trail</h3>
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
