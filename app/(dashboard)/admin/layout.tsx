import { notFound } from 'next/navigation';
import { AdminNavigation } from '@/components/admin-navigation';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { adminUnreadCount } from '@/lib/support/inbox';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAccountAccess('administration');
  const unreadCount = await adminUnreadCount();

  try {
    requireAdministrator(actor);
  } catch {
    //Authorization failures are classified here before React Server Components serialize them.
    //This produces the branded 404 for every admin URL without exposing authorization details.
    notFound();
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-96px)] w-full max-w-7xl flex-col lg:flex-row">
      <AdminNavigation isSuperAdmin={actor.roles.includes('super_admin')} unreadCount={unreadCount} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
