import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

export default async function AdminExportsPage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const isSuperAdmin = actor.roles.includes('super_admin');

  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">Exports</h1>
    <ul className="mt-6 max-w-md space-y-3 text-sm">
      <li><a className="underline" href="/api/admin/export/members">Member directory (CSV)</a></li>
      <li><a className="underline" href="/api/admin/export/notifications">Notification history (CSV)</a></li>
      {isSuperAdmin && (
        <>
          <li><a className="underline" href="/api/admin/export/payments">Payment ledger (CSV) — Super Admin</a></li>
          <li><a className="underline" href="/api/admin/export/audit-log">Audit log (CSV) — Super Admin</a></li>
        </>
      )}
    </ul>
    {!isSuperAdmin && <p className="mt-4 text-sm text-gray-500">Payment ledger and audit log exports require Super Admin.</p>}
  </main>;
}
