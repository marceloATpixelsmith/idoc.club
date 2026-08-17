import Link from 'next/link';
import { getPrivateMember, listAuditHistory, requireAccountAccess, searchMembersForAdmin } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { listActiveRoles } from '@/lib/membership/role-grants';
import { MEMBERSHIP_STATUS_LABELS } from '@/lib/membership/entitlement';
import { AdminProfileForm } from './admin-profile-form';
import { EntitlementCorrectionForm } from './entitlement-correction-form';
import { ReinstateForm, SuspendForm } from './membership-status-form';
import { RolesSection } from './roles-section';

export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<{ profileId?: string; q?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const isSuperAdmin = actor.roles.includes('super_admin');
  const { profileId: profileIdParam, q } = await searchParams;
  const query = q ?? '';
  const results = query ? await searchMembersForAdmin(query) : [];
  const profileId = profileIdParam ? Number(profileIdParam) : null;
  const selected = profileId && Number.isInteger(profileId) ? await getPrivateMember(profileId) : null;
  const auditHistory = profileId && Number.isInteger(profileId) ? await listAuditHistory(profileId) : [];
  const activeRoles = selected && isSuperAdmin ? await listActiveRoles(selected.profile.userId) : [];

  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">Members</h1>
    <form method="get" className="mt-6 flex max-w-md gap-2">
      <input className="block w-full rounded-md border-gray-300" defaultValue={query} name="q" placeholder="Search by name or email" type="text" />
      <button className="rounded-md border px-3 py-1 text-sm" type="submit">Search</button>
    </form>
    {results.length > 0 && (
      <ul className="mt-4 max-w-md divide-y border rounded-md">
        {results.map((member) => (
          <li key={member.profileId} className="p-3 text-sm">
            <Link className="underline" href={`/admin/members?q=${encodeURIComponent(query)}&profileId=${member.profileId}`}>
              {member.firstName} {member.lastName} — {member.email}
            </Link>
          </li>
        ))}
      </ul>
    )}
    {selected && (
      <>
        <section className="mt-8 max-w-2xl border rounded-lg p-4">
          <h2 className="font-medium text-gray-900">{selected.profile.firstName} {selected.profile.lastName}</h2>
          <p className="mt-1 text-sm text-gray-700">
            Status: {selected.entitlement ? (MEMBERSHIP_STATUS_LABELS[selected.entitlement.status] ?? selected.entitlement.status) : 'No membership on file'}
          </p>
          {selected.entitlement && <p className="text-sm text-gray-700">Paid through: {selected.entitlement.validUntil}</p>}
          <div className="mt-3 flex gap-4 text-sm">
            <Link className="underline" href={`/admin/payments?profileId=${selected.profile.id}`}>Record a payment</Link>
            <Link className="underline" href={`/admin/notifications?profileId=${selected.profile.id}`}>Notification history</Link>
          </div>
        </section>

        <section className="mt-8 max-w-2xl">
          <h3 className="font-medium text-gray-900">Membership status</h3>
          {selected.entitlement?.status === 'suspended'
            ? <ReinstateForm profileId={selected.profile.id} />
            : selected.entitlement
              ? <SuspendForm profileId={selected.profile.id} />
              : <p className="mt-2 text-sm text-gray-500">No membership on file — nothing to suspend.</p>}
        </section>

        <section className="mt-8 max-w-2xl">
          <h3 className="font-medium text-gray-900">Correct entitlement</h3>
          <EntitlementCorrectionForm currentValidUntil={selected.entitlement?.validUntil ?? null} profileId={selected.profile.id} />
        </section>

        <section className="mt-8 max-w-2xl">
          <h3 className="font-medium text-gray-900">Correct profile / roles &amp; levels</h3>
          <AdminProfileForm member={selected} profileId={selected.profile.id} />
        </section>

        {isSuperAdmin && (
          <section className="mt-8 max-w-2xl">
            <h3 className="font-medium text-gray-900">Application roles</h3>
            <RolesSection activeRoles={activeRoles} userId={selected.profile.userId} />
          </section>
        )}

        <section className="mt-8 max-w-2xl">
          <h3 className="font-medium text-gray-900">Audit trail</h3>
          <table className="mt-2 min-w-full border text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left">
                <th className="p-2">Action</th>
                <th className="p-2">When</th>
                <th className="p-2">Reason</th>
                <th className="p-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {auditHistory.length === 0 && (
                <tr><td className="p-2 text-gray-500" colSpan={4}>No audit entries for this member.</td></tr>
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
