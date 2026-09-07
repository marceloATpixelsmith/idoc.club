import Link from 'next/link';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

export default async function AdminPage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const isSuperAdmin = actor.roles.includes('super_admin');
  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">Administration</h1>
    <Link className="mt-6 block text-primary underline underline-offset-4 hover:opacity-80" href="/admin/members">Search members</Link>
    <Link className="mt-2 block text-primary underline underline-offset-4 hover:opacity-80" href="/admin/payments">Record a manual payment</Link>
    <Link className="mt-2 block text-primary underline underline-offset-4 hover:opacity-80" href="/admin/exports">Exports</Link>
    <Link className="mt-2 block text-primary underline underline-offset-4 hover:opacity-80" href="/admin/reconciliation">Stripe reconciliation</Link>
    {isSuperAdmin && <Link className="mt-2 block text-primary underline underline-offset-4 hover:opacity-80" href="/admin/organization">Organization Settings — Super Admin</Link>}
    {isSuperAdmin && <Link className="mt-2 block text-primary underline underline-offset-4 hover:opacity-80" href="/admin/security">Security operations — Super Admin</Link>}
  </main>;
}
