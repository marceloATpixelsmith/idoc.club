/** Single source of truth for the member dashboard's own subpages -- consumed by the left-hand
 * "My IDOC" sidebar (app/(dashboard)/dashboard/dashboard-tabs.tsx, which pairs each entry with an
 * icon) and by the site header's "My IDOC" dropdown (components/site/Header.tsx). Support is an
 * administrator/super_admin is never a support *member* (lib/support/inbox.ts's
 * requireSupportMember rejects them -- they use the separate /admin/support inbox instead), so
 * both consumers must filter it via dashboardNavItems(memberSupport) rather than rendering
 * DASHBOARD_NAV_ITEMS directly. */
export const DASHBOARD_NAV_ITEMS = [
  { href: '/dashboard/membership', label: 'My Membership' },
  { href: '/dashboard/profile', label: 'My Profile' },
  { href: '/dashboard/security', label: 'My Security' },
  { href: '/dashboard/support', label: 'Support/Contact' },
] as const;

export function dashboardNavItems(memberSupport: boolean) {
  return memberSupport ? DASHBOARD_NAV_ITEMS : DASHBOARD_NAV_ITEMS.filter((item) => item.href !== '/dashboard/support');
}

// Every entry's URL is a sibling path under /dashboard/ (never a prefix of another entry's), so a
// uniform exact-or-subpath match works for all of them -- e.g. Support does have its own subpages
// (/dashboard/support/[publicId]), and matches those by prefix like every other entry. Used both by
// the sidebar and by the header's "My IDOC" dropdown so the two never disagree about which entry is
// current.
export function isDashboardNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
