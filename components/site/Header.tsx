'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Menu, X, ChevronDown, Facebook } from 'lucide-react';
import { AuthenticatedUserMenu } from '@/components/authenticated-user-menu';
import { dashboardNavItems, isDashboardNavItemActive } from '@/lib/navigation/dashboard-nav';
import { HeaderShell } from './HeaderShell';

const nav = [
  { href: '/', label: 'Home' },
  { href: '/seminars', label: 'Seminars' },
  { href: '/membership', label: 'Membership' },
] as const;

// Contact renders separately, after My IDOC, rather than as part of this list.
const contactLink = { href: '/contact', label: 'Contact' } as const;

// Membership is a join/pricing pitch aimed at visitors who aren't members yet -- a signed-in
// member already has one, so the nav item just disappears rather than pointing them back at their
// own sales page.
function topNavItems(signedIn: boolean) {
  return nav.slice(1).filter((item) => item.href !== '/membership' || !signedIn);
}

const aboutLinks = [
  { href: '/about', label: 'About' },
  { href: '/about/board-members', label: 'Board Members' },
  { href: '/about/general-assembly', label: 'General Assembly' },
  { href: '/about/members-directory', label: 'Members Directory' },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function navClassName(active: boolean) {
  return `text-[0.8rem] font-medium uppercase tracking-[0.14em] transition-colors ${active ? 'text-gold' : 'text-muted-foreground hover:text-foreground'}`;
}

/** Shared hover/click dropdown shell for a top-level nav item with subpages -- used for both "About
 * IDOC" (always visible) and "My IDOC" (entitled members only). */
function NavDropdown({
  href,
  isItemActive = isActive,
  items,
  label,
  pathname,
}: {
  href: string;
  isItemActive?: (pathname: string, href: string) => boolean;
  items: readonly { href: string; label: string }[];
  label: string;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const active = items.some((item) => isItemActive(pathname, item.href));

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Link href={href} className={`flex items-center gap-1 ${navClassName(active)}`}>
        {label}
        <ChevronDown className="size-3" />
      </Link>

      {open && (
        <div className="absolute left-0 top-full z-[60] min-w-[16rem] border border-border bg-background/95 pt-2 backdrop-blur-md">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block px-5 py-3 text-[0.72rem] font-medium uppercase tracking-[0.14em] transition-colors hover:bg-surface hover:text-foreground ${isItemActive(pathname, item.href) ? 'text-gold' : 'text-muted-foreground'}`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A signed-in member always gets a "My IDOC" entry back to their account area -- the dashboard
 * subpages dropdown once entitled, or a plain link to /pricing beforehand (never-paid or
 * post-grace-expired), mirroring how /dashboard itself redirects an unentitled member straight to
 * /pricing (see app/(dashboard)/dashboard/page.tsx's paywall gate). Support is excluded from the
 * dropdown for a privileged administrator/super_admin, who isn't a support member (they use the
 * separate /admin/support inbox) -- see dashboardNavItems. */
function MyIdocNav({ entitled, memberSupport, pathname }: { entitled: boolean; memberSupport: boolean; pathname: string }) {
  if (!entitled) {
    return (
      <Link href="/pricing" className={navClassName(isActive(pathname, '/pricing'))}>
        My IDOC
      </Link>
    );
  }
  return <NavDropdown href="/dashboard" isItemActive={isDashboardNavItemActive} items={dashboardNavItems(memberSupport)} label="My IDOC" pathname={pathname} />;
}

function MemberLoginLink({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <Link href="/sign-in" className={className} onClick={onClick}>
      Member Login
    </Link>
  );
}

export function Header({
  entitled,
  loggedOut,
  memberSupport,
  showAdminDashboard,
  signedIn,
}: {
  entitled: boolean;
  loggedOut?: ReactNode;
  memberSupport: boolean;
  showAdminDashboard: boolean;
  signedIn: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <HeaderShell
      onLogoClick={() => setOpen(false)}
      right={
        <>
          <div className="hidden items-center gap-10 lg:flex">
            <nav className="flex items-center gap-7">
              <Link href="/" className={navClassName(isActive(pathname, '/'))}>
                Home
              </Link>

              <NavDropdown href="/about" items={aboutLinks} label="About IDOC" pathname={pathname} />

              {topNavItems(signedIn).map((item) => (
                <Link key={item.href} href={item.href} className={navClassName(isActive(pathname, item.href))}>
                  {item.label}
                </Link>
              ))}

              {signedIn && <MyIdocNav entitled={entitled} memberSupport={memberSupport} pathname={pathname} />}

              <Link href={contactLink.href} className={navClassName(isActive(pathname, contactLink.href))}>
                {contactLink.label}
              </Link>

              <span className="text-border" aria-hidden="true">
                |
              </span>
              <a
                href="https://www.facebook.com/groups/646981818825549/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="IDOC on Facebook"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <Facebook className="size-4" />
              </a>
            </nav>

            <Suspense fallback={<div className="h-9" />}>
              <AuthenticatedUserMenu
                showAdminDashboard={showAdminDashboard}
                loggedOut={loggedOut ?? <MemberLoginLink className="rounded-full border border-gold/60 px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-gold transition-colors hover:bg-gold hover:text-primary-foreground" />}
              />
            </Suspense>
          </div>

          <button
            type="button"
            aria-label="Toggle navigation"
            onClick={() => setOpen((v) => !v)}
            className="bg-transparent text-foreground lg:hidden"
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </>
      }
      below={
        open && (
          <nav className="border-t border-border bg-background px-5 py-4 lg:hidden">
            <ul className="flex flex-col gap-1">
              <li>
                <Link
                  href="/"
                  onClick={() => setOpen(false)}
                  className="block py-2 text-sm uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Home
                </Link>
              </li>
              <li className="pt-2">
                <p className="px-1 py-1 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-gold">
                  About IDOC
                </p>
                <ul className="flex flex-col">
                  {aboutLinks.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className="block py-2 pl-3 text-sm uppercase tracking-[0.14em] text-muted-foreground"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
              {topNavItems(signedIn).map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="block py-2 text-sm uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              {signedIn && (
                entitled ? (
                  <li className="pt-2">
                    <p className="px-1 py-1 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-gold">
                      My IDOC
                    </p>
                    <ul className="flex flex-col">
                      {dashboardNavItems(memberSupport).map((item) => (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => setOpen(false)}
                            className="block py-2 pl-3 text-sm uppercase tracking-[0.14em] text-muted-foreground"
                          >
                            {item.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ) : (
                  <li>
                    <Link
                      href="/pricing"
                      onClick={() => setOpen(false)}
                      className="block py-2 text-sm uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      My IDOC
                    </Link>
                  </li>
                )
              )}
              <li>
                <Link
                  href={contactLink.href}
                  onClick={() => setOpen(false)}
                  className="block py-2 text-sm uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {contactLink.label}
                </Link>
              </li>
              <li>
                <a
                  href="https://www.facebook.com/groups/646981818825549/"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 py-2 text-sm uppercase tracking-[0.14em] text-muted-foreground"
                >
                  <Facebook className="size-4" />
                  Facebook
                </a>
              </li>
              <li>
                <div className="mt-3 flex justify-center">
                  <Suspense fallback={<div className="h-9" />}>
                    <AuthenticatedUserMenu
                      showAdminDashboard={showAdminDashboard}
                      onNavigate={() => setOpen(false)}
                      loggedOut={loggedOut ?? <MemberLoginLink onClick={() => setOpen(false)} className="block rounded-full border border-gold/60 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-gold" />}
                    />
                  </Suspense>
                </div>
              </li>
            </ul>
          </nav>
        )
      }
    />
  );
}
