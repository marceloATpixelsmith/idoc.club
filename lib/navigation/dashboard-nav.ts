/** Single source of truth for the member dashboard's own subpages -- consumed by the left-hand
 * "My Dashboard" sidebar (app/(dashboard)/dashboard/dashboard-tabs.tsx, which pairs each entry with
 * an icon) and by the site header's "My IDOC" dropdown (components/site/Header.tsx). Support is
 * deliberately not one of these: it now lives behind the header's Contact/Support nav item instead
 * (see Header.tsx), not the dashboard sidebar. */
export const DASHBOARD_NAV_ITEMS = [
  { href: '/dashboard', label: 'My Membership' },
  { href: '/dashboard/profile', label: 'My Profile' },
  { href: '/dashboard/security', label: 'My Security' },
] as const;

// '/dashboard' has no subpages of its own (Payment Method lives inline on that same page), so it
// matches only exactly -- otherwise it would swallow every other item's subpages too, since it's a
// prefix of all of them. Used both by the sidebar and by the header's "My IDOC" dropdown so the two
// never disagree about which entry is current.
export function isDashboardNavItemActive(pathname: string, href: string): boolean {
  return href === '/dashboard' ? pathname === '/dashboard' : pathname === href || pathname.startsWith(`${href}/`);
}
