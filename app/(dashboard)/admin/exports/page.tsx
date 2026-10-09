import { Download } from 'lucide-react';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

function ExportRow({ href, label }: { href: string; label: string }) {
  return (
    <li className="list-disc">
      <span>{label}</span>
      <a aria-label={`Download ${label}`} className="ml-2 inline-flex align-middle text-gold hover:opacity-80" download href={href} title={`Download ${label}`}>
        <Download aria-hidden="true" className="size-4" />
      </a>
    </li>
  );
}

export default async function AdminExportsPage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const isSuperAdmin = actor.roles.includes('super_admin');

  return <main className="flex-1 py-8 px-5 lg:px-8">
    <h1 className="text-3xl font-semibold text-gold">Exports</h1>
    <ul className="mt-6 max-w-md list-outside space-y-3 pl-5 text-sm">
      <ExportRow href="/api/admin/export/members" label="Member directory" />
      <ExportRow href="/api/admin/export/notifications" label="Notification history" />
      {isSuperAdmin ? <>
        <ExportRow href="/api/admin/export/payments" label="Payment ledger — Super Admin" />
        <ExportRow href="/api/admin/export/audit-log" label="Audit log — Super Admin" />
      </> : null}
    </ul>
    {!isSuperAdmin ? <p className="mt-4 text-sm text-muted-foreground">Payment ledger and audit log exports require Super Admin.</p> : null}
  </main>;
}
