'use client';

import Link from 'next/link';
import { Header } from '@/components/site/Header';
import { NavigationLoadingProvider } from '@/components/navigation-loading';
import { Button } from '@/components/ui/button';
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
        supportUnread={navAccess.supportUnread}
        loggedOut={
          <>
            <Link
              href="/pricing"
              className="text-[0.8rem] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
            >
              Pricing
            </Link>
            <Button asChild className="rounded-full">
              <Link href="/sign-up">Sign Up</Link>
            </Button>
          </>
        }
      />
      <NavigationLoadingProvider>{children}</NavigationLoadingProvider>
    </section>
  );
}
