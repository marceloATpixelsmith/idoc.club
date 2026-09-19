import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const menu = readFileSync('components/authenticated-user-menu.tsx', 'utf8');
const dashboardShell = readFileSync('components/dashboard-shell.tsx', 'utf8');
const header = readFileSync('components/site/Header.tsx', 'utf8');
const dashboardLayout = readFileSync('app/(dashboard)/layout.tsx', 'utf8');
const marketingLayout = readFileSync('app/(marketing)/layout.tsx', 'utf8');
const dashboardTabs = readFileSync('app/(dashboard)/dashboard/dashboard-tabs.tsx', 'utf8');
const adminLayout = readFileSync('app/(dashboard)/admin/layout.tsx', 'utf8');
const publicUser = readFileSync('lib/db/queries.ts', 'utf8');
const navAccess = readFileSync('lib/auth/user-menu-access.ts', 'utf8');
const footer = readFileSync('components/site/Footer.tsx', 'utf8');

test('the footer hides Become a Member once signed in, and its phone number is a tel: link', () => {
  assert.match(footer, /export async function Footer\(\{ signedIn \}: \{ signedIn: boolean \}\)/);
  assert.match(footer, /\{!signedIn && \(/);
  assert.match(footer, /Become a Member/);
  assert.match(footer, /href="tel:\+32476914795"/);
  assert.match(marketingLayout, /<Footer signedIn=\{navAccess\.signedIn\} \/>/);
});

test('the same header renders on marketing and dashboard pages alike', () => {
  assert.match(dashboardShell, /<Header\b/);
  assert.match(dashboardLayout, /getMainNavAccess\(\)/);
  assert.match(marketingLayout, /<Header\b/);
  assert.match(marketingLayout, /getMainNavAccess\(\)/);
});

test('logged-out dashboard navigation retains Pricing and Sign Up', () => {
  assert.match(dashboardShell, />\s*Pricing\s*</);
  assert.match(dashboardShell, /href="\/sign-up">Sign Up</);
});

test('both navigation surfaces share the authenticated initials menu', () => {
  assert.match(dashboardShell, /<Header\b/);
  assert.match(header, /<AuthenticatedUserMenu/);
  assert.doesNotMatch(header, />\s*(?:My )?Dashboard\s*</);
  assert.match(menu, /userInitials\(user\.firstName, user\.lastName, user\.email\)/);
  assert.match(menu, /bg-gold/);
  assert.match(menu, /text-primary-foreground/);
});

test('the shared menu drops My Dashboard, keeping only the conditional Admin Dashboard and Sign out', () => {
  assert.doesNotMatch(menu, /<span>My Dashboard<\/span>/);
  const adminItem = menu.indexOf('<span>Admin Dashboard</span>');
  const signOutItem = menu.indexOf('<span>Sign out</span>');
  assert.ok(adminItem > -1);
  assert.ok(signOutItem > adminItem);
  assert.match(menu, /showAdminDashboard &&/);
  assert.match(menu, /href="\/admin"/);
});

test('the header exposes a My IDOC dropdown of the dashboard subpages (including Support), gated on entitlement -- falling back to a plain /pricing link for a signed-in member who is not yet entitled', () => {
  assert.match(header, /signedIn && <MyIdocNav entitled=\{entitled\} memberSupport=\{memberSupport\} pathname=\{pathname\} \/>/);
  assert.match(header, /label="My IDOC"/);
  assert.match(header, /href="\/pricing"/);
  assert.match(header, /from '@\/lib\/navigation\/dashboard-nav'/);
});

test('Contact is a plain nav item, never swapped for Support', () => {
  assert.match(header, /\{ href: '\/contact', label: 'Contact' \}/);
  assert.doesNotMatch(header, /ContactNavLink/);
  assert.doesNotMatch(header, /'\/dashboard\/support' : '\/contact'/);
});

test('Contact is hidden only for a member whose My IDOC actually offers Support/Contact instead -- never for signed-in accounts with no such substitute (onboarding, unpaid, or privileged administrators)', () => {
  const desktopContactBlock = header.slice(header.indexOf('<MyIdocNav '), header.indexOf('<span className="text-border"'));
  assert.match(desktopContactBlock, /\{\(!signedIn \|\| !memberSupport\) && \(/);
  assert.match(desktopContactBlock, /href=\{contactLink\.href\}/);

  const mobilePricingFallback = header.lastIndexOf('href="/pricing"');
  const mobileContactBlock = header.slice(mobilePricingFallback, header.indexOf('facebook.com/groups', mobilePricingFallback));
  assert.match(mobileContactBlock, /\{\(!signedIn \|\| !memberSupport\) && \(/);
  assert.match(mobileContactBlock, /href=\{contactLink\.href\}/);
});

test('Contact renders after My IDOC in both the desktop and mobile nav', () => {
  const myIdocIndex = header.indexOf('<MyIdocNav ');
  const desktopContactIndex = header.indexOf('href={contactLink.href}');
  assert.ok(myIdocIndex > -1 && desktopContactIndex > myIdocIndex);

  const mobileMyIdocSection = header.indexOf("My IDOC\n                    </p>");
  const mobilePricingFallback = header.indexOf('href="/pricing"');
  const mobileContactIndex = header.lastIndexOf('href={contactLink.href}');
  assert.ok(mobileContactIndex > mobileMyIdocSection && mobileContactIndex > mobilePricingFallback);
});

test('Membership is hidden from the top nav once signed in -- a member already has one', () => {
  assert.match(header, /item\.href !== '\/membership' \|\| !signedIn/);
  assert.match(header, /topNavItems\(signedIn\)/g);
  assert.doesNotMatch(header, /nav\.slice\(1\)\.map/);
});

test('Support lives in both the dashboard sidebar and the header My IDOC dropdown, hidden from privileged administrators in either', () => {
  assert.match(dashboardTabs, /LifeBuoy/);
  assert.match(dashboardTabs, /'\/dashboard\/support': LifeBuoy/);
  const dashboardNav = readFileSync('lib/navigation/dashboard-nav.ts', 'utf8');
  assert.match(dashboardNav, /\{ href: '\/dashboard\/support', label: 'Support\/Contact' \}/);
  assert.match(dashboardNav, /export function dashboardNavItems\(memberSupport: boolean\)/);
  assert.match(dashboardTabs, /dashboardNavItems\(memberSupport\)/);
  assert.match(header, /dashboardNavItems\(memberSupport\)/);
});

test('every dashboard nav item URL matches its label and no entry is a prefix of another, in both the sidebar and the header dropdown, so a dashboard subpage never highlights two items at once', () => {
  const dashboardNav = readFileSync('lib/navigation/dashboard-nav.ts', 'utf8');
  assert.match(dashboardNav, /\{ href: '\/dashboard\/membership', label: 'My Membership' \}/);
  assert.match(dashboardNav, /return pathname === href \|\| pathname\.startsWith\(`\$\{href\}\/`\)/);
  assert.match(dashboardTabs, /isDashboardNavItemActive/);
  assert.doesNotMatch(dashboardTabs, /function isActiveTab/);
  assert.match(header, /isItemActive=\{isDashboardNavItemActive\}/);
});

test('a signed-in member who is not yet entitled still has a way back to Pricing from the header', () => {
  assert.match(navAccess, /signedIn: boolean/);
  assert.match(header, /if \(!entitled\) \{/);
  assert.match(header, /href="\/pricing"/);
});

test('the dashboard sidebar heading reads My IDOC, matching the header nav item it belongs to', () => {
  assert.doesNotMatch(dashboardTabs, />My Dashboard</);
  assert.match(dashboardTabs, />My IDOC</);
});

test('nav access is a server-derived capability without changing PublicUser', () => {
  assert.match(navAccess, /requireAccountAccess\(onboarding \? 'onboarding' : 'profile'\)/);
  assert.match(navAccess, /isAdministrator\(actor\)/);
  assert.match(publicUser, /export type PublicUser = \{ email: string; firstName: string \| null; id: number; lastName: string \| null \}/);
  assert.doesNotMatch(publicUser.slice(0, publicUser.indexOf('export type SecurityPageUser')), /role|administrator/i);
});

test('an onboarding account counts as signed in for nav-visibility purposes, mirroring the dashboard layout\'s own onboarding special-case (behavioral proof: tests/main-nav-access.integration.ts)', () => {
  assert.match(navAccess, /const onboarding = user\?\.accountState === 'onboarding'/);
  assert.match(navAccess, /const entitled = !onboarding && /);
});

test('direct admin access remains server-authorized independently of menu visibility', () => {
  assert.match(adminLayout, /requireAccountAccess\('administration'\)/);
  assert.match(adminLayout, /requireAdministrator\(actor\)/);
});

test('the menu supports mouse hover plus keyboard, click, and touch operation', () => {
  assert.match(menu, /onPointerEnter=\{openForMouse\}/);
  assert.match(menu, /onPointerLeave=\{closeForMouse\}/);
  assert.match(menu, /event\.pointerType !== 'mouse'/);
  assert.match(menu, /<DropdownMenu open=\{open\} onOpenChange=\{setOpen\} modal=\{false\}>/);
  assert.match(menu, /<DropdownMenuTrigger asChild>/);
  assert.match(menu, /type="button"/);
  assert.match(menu, /aria-label=\{`Open \$\{accessibleName\} menu`\}/);
});

test('sign out retains the CSRF-protected action and clears shared user state', () => {
  assert.match(menu, /signOut\(readCsrfTokenFromDocumentCookie\(\)\)/);
  assert.match(menu, /mutate\('\/api\/user'\)/);
  assert.match(menu, /router\.push\('\/'\)/);
});

test('navigation loading remains scoped to dashboard content and absent from public pages', () => {
  assert.match(dashboardShell, /<NavigationLoadingProvider>\{children\}<\/NavigationLoadingProvider>/);
  assert.doesNotMatch(marketingLayout, /NavigationLoading/);
});
