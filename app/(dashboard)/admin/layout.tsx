import { notFound, redirect } from 'next/navigation';
import { AdminNavigation } from '@/components/admin-navigation';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireAdministrator, type Actor } from '@/lib/membership/authorization';
import { adminUnreadCount } from '@/lib/support/inbox';
import { getAccountStateUser } from '@/lib/db/queries';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // A canonical cookie can outlive its server-side session registry entry. Middleware verifies the
  // signed cookie itself, while getAccountStateUser() performs the authoritative session/account
  // check using a minimal projection that cannot expose passwordHash through Server Component
  // tracing. Anonymous or expired-session visitors should sign in again; only an authenticated
  // account that lacks admin authority is intentionally hidden behind notFound().
  if (!(await getAccountStateUser())) redirect('/sign-in');

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
    <div data-idoc-admin-root className="flex min-h-[calc(100dvh-96px)] w-full flex-col lg:flex-row">
      {/* Data promotion only runs from the staging application (lib/admin/data-promotion.ts), so production does not list it. Email previews 404 on Vercel Production, so it is hidden there too. */}
      <AdminNavigation isSuperAdmin={actor.roles.includes('super_admin')} isProduction={process.env.VERCEL_ENV === 'production'} showDataPromotion={process.env.DB_SCHEMA === 'idoc_staging'} unreadCount={unreadCount} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
