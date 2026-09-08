'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { AuthenticatedUserMenu } from '@/components/authenticated-user-menu';
import { NavigationLoadingProvider } from '@/components/navigation-loading';
import { HeaderShell } from '@/components/site/HeaderShell';
import { Button } from '@/components/ui/button';

export function DashboardShell({
  children,
  showAdminDashboard,
}: {
  children: React.ReactNode;
  showAdminDashboard: boolean;
}) {
  return (
    <section className="flex min-h-screen flex-col">
      <HeaderShell
        right={
          <div className="flex items-center space-x-6">
            <Suspense fallback={<div className="h-9" />}>
              <AuthenticatedUserMenu
                showAdminDashboard={showAdminDashboard}
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
            </Suspense>
          </div>
        }
      />
      <NavigationLoadingProvider>{children}</NavigationLoadingProvider>
    </section>
  );
}
