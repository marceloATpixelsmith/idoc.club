import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db/drizzle.ts';
import { users } from '../lib/db/schema.ts';
import { getMainNavAccess } from '../lib/auth/user-menu-access.ts';
import { setSession } from '../lib/auth/session.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { closeHarness, createUser, resetIdoc } from './postgres-harness.ts';

// getMainNavAccess() (lib/auth/user-menu-access.ts) drives the site header/footer's Membership and
// Become-a-Member visibility. A Codex review finding on this pull request caught that an onboarding
// account -- real, signed in, and already shown the initials menu by /api/user -- was being treated
// as LOGGED_OUT here (requireAccountAccess('profile') rejects the 'onboarding' account state), so
// the join/pricing links kept showing to someone who was already signed in. This proves the fix
// against a real onboarding account and a real session, the same way dashboard/layout.tsx's own
// onboarding handling is exercised.
Object.assign(process.env, { AUTH_SECRET: 'integration-auth-secret-that-is-long-enough', BASE_URL: 'http://localhost:3000' });

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}

beforeEach(resetIdoc);
after(closeHarness);

test('an onboarding account is signed in for header/footer nav purposes, even though it is not yet entitled', async () => {
  const fixture = await createUser('onboarding');
  const [user] = await db.select().from(users).where(eq(users.id, fixture.id)).limit(1);
  const cookies = new TestCookies();
  const access = await withTestRequestCookies(cookies, async () => {
    await setSession(user);
    return getMainNavAccess();
  });
  assert.equal(access.signedIn, true);
  assert.equal(access.entitled, false);
  assert.equal(access.memberSupport, false);
  assert.equal(access.showAdminDashboard, false);
});

test('an anonymous visitor is not signed in', async () => {
  const cookies = new TestCookies();
  const access = await withTestRequestCookies(cookies, () => getMainNavAccess());
  assert.deepEqual(access, { entitled: false, memberSupport: false, showAdminDashboard: false, signedIn: false });
});
