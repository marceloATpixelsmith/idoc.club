import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const menu = readFileSync('components/authenticated-user-menu.tsx', 'utf8');
const dashboardShell = readFileSync('components/dashboard-shell.tsx', 'utf8');
const marketingHeader = readFileSync('components/site/Header.tsx', 'utf8');
const adminLayout = readFileSync('app/(dashboard)/admin/layout.tsx', 'utf8');
const publicUser = readFileSync('lib/db/queries.ts', 'utf8');
const menuAccess = readFileSync('lib/auth/user-menu-access.ts', 'utf8');

test('logged-out dashboard navigation retains Pricing and Sign Up', () => {
  assert.match(dashboardShell, />\s*Pricing\s*</);
  assert.match(dashboardShell, /href="\/sign-up">Sign Up</);
});

test('both navigation surfaces share the authenticated initials menu', () => {
  assert.match(dashboardShell, /<AuthenticatedUserMenu/);
  assert.match(marketingHeader, /<AuthenticatedUserMenu/);
  assert.doesNotMatch(marketingHeader, />\s*(?:My )?Dashboard\s*</);
  assert.match(menu, /userInitials\(user\.firstName, user\.lastName, user\.email\)/);
  assert.match(menu, /bg-gold/);
  assert.match(menu, /text-primary-foreground/);
});

test('the shared menu links first to My Dashboard and conditionally exposes Admin Dashboard', () => {
  const memberItem = menu.indexOf('<span>My Dashboard</span>');
  const adminItem = menu.indexOf('<span>Admin Dashboard</span>');
  const signOutItem = menu.indexOf('<span>Sign out</span>');
  assert.ok(memberItem > -1);
  assert.ok(adminItem > memberItem);
  assert.ok(signOutItem > adminItem);
  assert.match(menu, /href="\/dashboard"/);
  assert.match(menu, /showAdminDashboard &&/);
  assert.match(menu, /href="\/admin"/);
});

test('admin visibility uses a server-derived capability without changing PublicUser', () => {
  assert.match(menuAccess, /isAdministrator\(await requireAccountAccess\('profile'\)\)/);
  assert.match(publicUser, /export type PublicUser = \{ email: string; firstName: string \| null; id: number; lastName: string \| null \}/);
  assert.doesNotMatch(publicUser.slice(0, publicUser.indexOf('export type SecurityPageUser')), /role|administrator/i);
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
  assert.doesNotMatch(marketingHeader, /NavigationLoading/);
});
