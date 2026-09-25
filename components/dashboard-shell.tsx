'use client';

import { Header } from '@/components/site/Header';
import { NavigationLoadingProvider } from '@/components/navigation-loading';
import { ProtectedSessionRedirect } from '@/components/protected-session-redirect';
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
      <ProtectedSessionRedirect initiallySignedIn={navAccess.signedIn} />
      <Header
        entitled={navAccess.entitled}
        memberSupport={navAccess.memberSupport}
        showAdminDashboard={navAccess.showAdminDashboard}
        signedIn={navAccess.signedIn}
      />
      <NavigationLoadingProvider>{children}</NavigationLoadingProvider>
    </section>
  );
}
