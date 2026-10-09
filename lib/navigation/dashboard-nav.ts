/** Single source of truth for My IDOC dashboard subpages. Member support lives under Contact. */
export const DASHBOARD_NAV_ITEMS = [
  { href: '/dashboard/membership', label: 'My Membership' },
  { href: '/dashboard/profile', label: 'My Profile' },
  { href: '/dashboard/security', label: 'My Security' },
] as const;

export function dashboardNavItems() {
  return DASHBOARD_NAV_ITEMS;
}

// Every entry's URL is a sibling path under /dashboard/, so exact-or-subpath matching works.
export function isDashboardNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
