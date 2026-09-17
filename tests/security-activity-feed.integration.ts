import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { eq } from 'drizzle-orm';
import { getActivityLogs } from '../lib/db/queries.ts';
import { setSession } from '../lib/auth/session.ts';
import { signOut } from '../app/(login)/actions.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { csrfCookieName } from '../lib/security/csrf-tokens.ts';
import { db } from '../lib/db/drizzle.ts';
import { users } from '../lib/db/schema.ts';
import { closeHarness, createCompleteGraph, createUser, resetIdoc, sql } from './postgres-harness.ts';

// My Security's "Activity" card (getActivityLogs(), lib/db/queries.ts) used to read from
// activity_logs, a Vercel SaaS-starter-template table nothing in this codebase ever wrote a row to
// -- so it showed "No activity yet." for every member, always, including right after they signed in.
// This proves the real fix end to end against a real Postgres row: setSession() and signOut() (the
// funnel every login/logout path converges on) now write idoc.audit_log rows a member can actually
// see, a curated allow-list keeps unrelated audit_log actions (membership/profile changes, which
// belong to other pages' own history) out of this security-specific feed, and one member never sees
// another member's activity.

Object.assign(process.env, { AUTH_SECRET: 'integration-auth-secret-that-is-long-enough', BASE_URL: 'http://localhost:3000' });

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}

beforeEach(resetIdoc);
after(closeHarness);

test('signing in and out both appear in the member\'s own Activity feed, most recent first', async () => {
  const { user } = await createCompleteGraph();
  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const cookies = new TestCookies();

  await withTestRequestCookies(cookies, () => withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, async () => {
    await setSession(row);
    const csrfToken = cookies.get(csrfCookieName())?.value ?? '';
    await signOut(csrfToken);
    // getActivityLogs() itself requires a live session -- re-establish one (a second, real sign-in)
    // purely to read the feed back, the same way a member would sign back in and check My Security.
    await setSession(row);
    const logs = await getActivityLogs();
    const actions = logs.map((log) => log.action);
    assert.ok(actions.includes('account.session.signed_in'), 'a sign-in must appear in the feed');
    assert.ok(actions.includes('account.session.signed_out'), 'a sign-out must appear in the feed');
    // Most recent first: the second sign-in (read back) sorts ahead of the sign-out, which sorts
    // ahead of the first sign-in.
    assert.deepEqual(actions.slice(0, 2), ['account.session.signed_in', 'account.session.signed_out']);
  }));
});

test('the Activity feed only shows security-relevant actions for the signed-in member, never unrelated audit_log rows or another member\'s events', async () => {
  const { user } = await createCompleteGraph();
  const other = await createUser();
  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  // A real, unrelated audit_log action this same member also caused -- belongs to My Profile's own
  // history, not a security feed.
  await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id) values (${user.id},'member.profile.created','profile','1')`;
  // Another member's own sign-in -- must never leak into this member's feed.
  await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id) values (${other.id},'account.session.signed_in','user',${String(other.id)})`;
  const cookies = new TestCookies();

  await withTestRequestCookies(cookies, () => withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, async () => {
    await setSession(row);
    const logs = await getActivityLogs();
    const actions = logs.map((log) => log.action);
    assert.ok(!actions.includes('member.profile.created'), 'a non-security audit action must not appear in the security Activity feed');
    assert.equal(logs.length, 1, 'only this member\'s own sign-in should appear, not the seeded unrelated row or the other member\'s row');
    assert.equal(actions[0], 'account.session.signed_in');
  }));
});
