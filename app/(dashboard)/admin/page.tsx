import Link from 'next/link';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

export default async function AdminPage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">Administration</h1>
    <Link className="mt-6 inline-block underline" href="/admin/payments">Record a manual payment</Link>
  </main>;
}
