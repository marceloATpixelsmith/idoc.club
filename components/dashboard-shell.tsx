'use client';

import { Header } from '@/components/site/Header';
import type { MainNavAccess } from '@/lib/auth/user-menu-access';

export function DashboardShell({
  children,
  navAccess,
}: {
  children: React.ReactNode;
  navAccess: MainNavAccess;
}) {
  return (
    <section className="flex min-h-screen flex-col">
      <Header
        entitled={navAccess.entitled}
        memberSupport={navAccess.memberSupport}
        showAdminDashboard={navAccess.showAdminDashboard}
        signedIn={navAccess.signedIn}
      />
      {children}
    </section>
  );
}
