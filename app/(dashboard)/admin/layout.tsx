import { notFound } from 'next/navigation';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAccountAccess('administration');

  try {
    requireAdministrator(actor);
  } catch {
    //Authorization failures are classified here before React Server Components serialize them.
    //This produces the branded 404 for every admin URL without exposing authorization details.
    notFound();
  }

  return children;
}
