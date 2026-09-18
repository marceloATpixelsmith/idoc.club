import { DashboardShell } from '@/components/dashboard-shell';
import { getMainNavAccess } from '@/lib/auth/user-menu-access';

export default async function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell navAccess={await getMainNavAccess()}>
      {children}
    </DashboardShell>
  );
}
