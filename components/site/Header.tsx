'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Suspense, useRef, useState } from 'react';
import { Menu, X, Facebook, UserCog } from 'lucide-react';
import { AuthenticatedUserMenu } from '@/components/authenticated-user-menu';
import { dashboardNavItems, isDashboardNavItemActive } from '@/lib/navigation/dashboard-nav';
import { HeaderShell } from './HeaderShell';

const nav = [
  { href: '/', label: 'Home' },
  { href: '/seminars', label: 'Seminars/Courses' },
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

function isAboutItemActive(pathname: string, href: string) {
  return href === '/about' ? pathname === href : isActive(pathname, href);
}

function navClassName(active: boolean) {
  return `text-[0.8125rem] font-medium uppercase tracking-[0.14em] transition-colors ${active ? 'text-gold' : 'text-muted-foreground hover:text-foreground'}`;
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
  const triggerRef = useRef<HTMLAnchorElement>(null);
  // Escape hands focus back to the trigger; without this guard that refocus would reopen the menu.
  const escapedRef = useRef(false);
  const active = items.some((item) => isItemActive(pathname, item.href));

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => {
        if (!escapedRef.current) setOpen(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        escapedRef.current = true;
        setOpen(false);
        triggerRef.current?.focus();
        escapedRef.current = false;
      }}
    >
      <Link ref={triggerRef} href={href} className={`flex items-center gap-1 ${navClassName(active)}`}>
        {label}
        <svg
          aria-hidden="true"
          viewBox="0 0 8 5"
          className={`h-[5px] w-2 fill-current transition-transform duration-300 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        >
          <path d="M0 0h8L4 5z" />
        </svg>
      </Link>

      {/* Always mounted so the 3D flip can animate both ways. The container's top padding is the
       * hover bridge across the gap between trigger and panel. */}
      <div className="idoc-flip-menu" data-open={open}>
        <div className="idoc-flip-menu__panel border border-border bg-background/95 backdrop-blur-md">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              tabIndex={open ? 0 : -1}
              className={`idoc-flip-menu__link block px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] transition-colors hover:bg-surface hover:text-foreground ${isItemActive(pathname, item.href) ? 'text-gold' : 'text-muted-foreground'}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

const mobileLinkClassName = 'block py-2 text-sm uppercase tracking-[0.14em] text-muted-foreground';

/** Mobile counterpart of NavDropdown: the label row toggles an inline submenu, with the same gold
 * triangle that flips when open. The submenu stays mounted so the height can animate both ways. */
function MobileNavSection({
  isItemActive = isActive,
  items,
  label,
  onNavigate,
  pathname,
}: {
  isItemActive?: (pathname: string, href: string) => boolean;
  items: readonly { href: string; label: string }[];
  label: string;
  onNavigate: () => void;
  pathname: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 bg-transparent px-1 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold"
      >
        {label}
        <svg
          aria-hidden="true"
          viewBox="0 0 8 5"
          className={`h-[5px] w-2 fill-current transition-transform duration-300 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="M0 0h8L4 5z" />
        </svg>
      </button>
      <div className="idoc-mobile-submenu" data-open={expanded} inert={!expanded}>
        <ul className="flex flex-col overflow-hidden">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                className={`${mobileLinkClassName} pl-3 ${isItemActive(pathname, item.href) ? 'text-gold' : ''}`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

/** A signed-in member always gets a "My IDOC" entry back to their account area -- the dashboard
 * subpages dropdown once entitled, or a plain link to /dashboard/membership beforehand (never-paid or
 * post-grace-expired), where the membership page itself renders the payment controls. Support is
 * reached through Contact for eligible members; administrators use /admin/support. */
function MyIdocNav({ entitled, pathname }: { entitled: boolean; pathname: string }) {
  if (!entitled) {
    return (
      <Link href="/dashboard/membership" className={navClassName(isActive(pathname, '/dashboard/membership'))}>
        My IDOC
      </Link>
    );
  }
  return <NavDropdown href="/dashboard" isItemActive={isDashboardNavItemActive} items={dashboardNavItems()} label="My IDOC" pathname={pathname} />;
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
  showAdminDashboard,
  signedIn,
}: {
  entitled: boolean;
  loggedOut?: ReactNode;
  showAdminDashboard: boolean;
  signedIn: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isAdminArea = pathname === '/admin' || pathname.startsWith('/admin/');
  const closeMenu = () => setOpen(false);

  return (
    <HeaderShell
      onLogoClick={closeMenu}
      right={
        <>
          <div className="hidden items-center gap-10 lg:flex">
            {isAdminArea ? (
              <div className="flex items-center gap-2 text-[0.8125rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <UserCog aria-hidden="true" className="size-4 text-gold" />
                <span>Admin Mode</span>
              </div>
            ) : (
              <nav className="flex items-center gap-7">
                <Link href="/" className={navClassName(isActive(pathname, '/'))}>
                  Home
                </Link>

                <NavDropdown href="/about" isItemActive={isAboutItemActive} items={aboutLinks} label="About IDOC" pathname={pathname} />

                {topNavItems(signedIn).map((item) => (
                  <Link key={item.href} href={item.href} className={navClassName(isActive(pathname, item.href))}>
                    {item.label}
                  </Link>
                ))}

                {signedIn && <MyIdocNav entitled={entitled} pathname={pathname} />}

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
            )}

            <Suspense fallback={<div className="h-9" />}>
              <AuthenticatedUserMenu
                showAdminDashboard={showAdminDashboard}
                loggedOut={loggedOut ?? <MemberLoginLink className="rounded-full border border-gold/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold transition-colors hover:bg-gold hover:text-primary-foreground" />}
              />
            </Suspense>
          </div>

          {isAdminArea ? (
            <div className="flex items-center gap-5 lg:hidden">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <UserCog aria-hidden="true" className="size-4 text-gold" />
                <span>Admin Mode</span>
              </div>
              <Suspense fallback={<div className="h-9" />}>
                <AuthenticatedUserMenu
                  showAdminDashboard={showAdminDashboard}
                  loggedOut={loggedOut ?? <MemberLoginLink className="rounded-full border border-gold/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold transition-colors hover:bg-gold hover:text-primary-foreground" />}
                />
              </Suspense>
            </div>
          ) : (
            <button
              type="button"
              aria-label="Toggle navigation"
              onClick={() => setOpen((v) => !v)}
              className="bg-transparent text-foreground lg:hidden"
            >
              {open ? <X className="size-6" /> : <Menu className="size-6" />}
            </button>
          )}
        </>
      }
      below={
        !isAdminArea && (
          // Always mounted so the flip animation can run both ways; inert keeps the closed panel
          // out of the tab order and away from assistive technology.
          <div className="idoc-mobile-nav lg:hidden" data-open={open} inert={!open}>
            <div className="idoc-mobile-nav__clip">
            <nav className="idoc-mobile-nav__panel border-t border-border bg-background px-5 py-4">
              <ul className="flex flex-col gap-1">
                <li>
                  <Link href="/" onClick={closeMenu} className={mobileLinkClassName}>
                    Home
                  </Link>
                </li>
                <MobileNavSection isItemActive={isAboutItemActive} items={aboutLinks} label="About IDOC" onNavigate={closeMenu} pathname={pathname} />
                {topNavItems(signedIn).map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} onClick={closeMenu} className={mobileLinkClassName}>
                      {item.label}
                    </Link>
                  </li>
                ))}
                {signedIn &&
                  (entitled ? (
                    <MobileNavSection isItemActive={isDashboardNavItemActive} items={dashboardNavItems()} label="My IDOC" onNavigate={closeMenu} pathname={pathname} />
                  ) : (
                    <li>
                      <Link href="/dashboard/membership" onClick={closeMenu} className={mobileLinkClassName}>
                        My IDOC
                      </Link>
                    </li>
                  ))}
                <li>
                  <Link href={contactLink.href} onClick={closeMenu} className={mobileLinkClassName}>
                    {contactLink.label}
                  </Link>
                </li>
                <li>
                  <a
                    href="https://www.facebook.com/groups/646981818825549/"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={closeMenu}
                    className={`flex items-center gap-2 ${mobileLinkClassName}`}
                  >
                    <Facebook className="size-4" />
                    Facebook
                  </a>
                </li>
                <li className="mt-2">
                  <Suspense fallback={<div className="h-9" />}>
                    <AuthenticatedUserMenu
                      mobile
                      showAdminDashboard={showAdminDashboard}
                      onNavigate={closeMenu}
                      loggedOut={loggedOut ?? <MemberLoginLink onClick={closeMenu} className={`${mobileLinkClassName} text-gold`} />}
                    />
                  </Suspense>
                </li>
              </ul>
            </nav>
            </div>
          </div>
        )
      }
    />
  );
}
