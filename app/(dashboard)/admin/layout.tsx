import { notFound } from 'next/navigation';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { AdminNavigation } from '@/components/admin-navigation';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireAdministrator, type Actor } from '@/lib/membership/authorization';
import { adminUnreadCount } from '@/lib/support/inbox';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let actor: Actor;
  try {
    actor = await requireAccountAccess('administration');
    requireAdministrator(actor);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  const unreadCount = await adminUnreadCount();

  return (
    <NuqsAdapter>
      <div className="mx-auto flex min-h-[calc(100dvh-96px)] w-full max-w-7xl flex-col lg:flex-row">
        <AdminNavigation isSuperAdmin={actor.roles.includes('super_admin')} unreadCount={unreadCount} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </NuqsAdapter>
  );
}
