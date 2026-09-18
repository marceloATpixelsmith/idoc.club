/** Single source of truth for the member dashboard's own subpages -- consumed by the left-hand
 * "My IDOC" sidebar (app/(dashboard)/dashboard/dashboard-tabs.tsx, which pairs each entry with an
 * icon) and by the site header's "My IDOC" dropdown (components/site/Header.tsx). Support is an
 * administrator/super_admin is never a support *member* (lib/support/inbox.ts's
 * requireSupportMember rejects them -- they use the separate /admin/support inbox instead), so
 * both consumers must filter it via dashboardNavItems(memberSupport) rather than rendering
 * DASHBOARD_NAV_ITEMS directly. */
export const DASHBOARD_NAV_ITEMS = [
  { href: '/dashboard', label: 'My Membership' },
  { href: '/dashboard/profile', label: 'My Profile' },
  { href: '/dashboard/security', label: 'My Security' },
  { href: '/dashboard/support', label: 'Support' },
] as const;

export function dashboardNavItems(memberSupport: boolean) {
  return memberSupport ? DASHBOARD_NAV_ITEMS : DASHBOARD_NAV_ITEMS.filter((item) => item.href !== '/dashboard/support');
}

// '/dashboard' has no subpages of its own (Payment Method lives inline on that same page), so it
// matches only exactly -- otherwise it would swallow every other item's subpages too, since it's a
// prefix of all of them. Support does have its own subpages (/dashboard/support/[publicId]), so it
// -- like every other non-root item -- still matches by prefix. Used both by the sidebar and by the
// header's "My IDOC" dropdown so the two never disagree about which entry is current.
export function isDashboardNavItemActive(pathname: string, href: string): boolean {
  return href === '/dashboard' ? pathname === '/dashboard' : pathname === href || pathname.startsWith(`${href}/`);
}
