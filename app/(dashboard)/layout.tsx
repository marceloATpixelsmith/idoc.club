import { DashboardShell } from '@/components/dashboard-shell';
import { mayShowAdminDashboard } from '@/lib/auth/user-menu-access';

export default async function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell showAdminDashboard={await mayShowAdminDashboard()}>
      {children}
    </DashboardShell>
  );
}
