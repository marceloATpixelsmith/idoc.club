import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { sessionCookieName, setSession } from '../lib/auth/session.ts';
import { readActiveSession } from '../lib/auth/session-registry.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { db } from '../lib/db/drizzle.ts';
import { users } from '../lib/db/schema.ts';
import { eq } from 'drizzle-orm';
import { closeHarness, createUser, resetIdoc } from './postgres-harness.ts';

// The user's own stated reason for wanting device info on the "Active sessions" list: it is only
// worth showing sessions and offering per-session revocation if the owner can actually tell their
// own devices apart from a possible intruder's. This exercises the real production capture path --
// setSession(), the single funnel point for every session-establishing flow -- against a real
// Postgres row, not a parallel helper standing in for it.

Object.assign(process.env, {
  AUTH_SECRET: 'integration-auth-secret-that-is-long-enough',
  BASE_URL: 'http://localhost:3000',
});

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}

beforeEach(resetIdoc);
after(closeHarness);

test('setSession derives and persists a device label from the request User-Agent header', async () => {
  const fixture = await createUser();
  const [user] = await db.select().from(users).where(eq(users.id, fixture.id)).limit(1);
  const cookies = new TestCookies();

  await withTestRequestCookies(cookies, async () => {
    await setSession(user);
  }, '127.0.0.1', undefined,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36');

  const sessionCookie = cookies.get(sessionCookieName(process.env))!;
  const raw = JSON.parse(Buffer.from(sessionCookie.value.split('.')[1], 'base64url').toString());
  const persisted = await readActiveSession(raw.sessionId, user.id);
  assert.equal(persisted?.deviceLabel, 'Chrome on Windows');
});

test('setSession persists no device label when the request carries no User-Agent header', async () => {
  const fixture = await createUser();
  const [user] = await db.select().from(users).where(eq(users.id, fixture.id)).limit(1);
  const cookies = new TestCookies();

  await withTestRequestCookies(cookies, async () => {
    await setSession(user);
  });

  const sessionCookie = cookies.get(sessionCookieName(process.env))!;
  const raw = JSON.parse(Buffer.from(sessionCookie.value.split('.')[1], 'base64url').toString());
  const persisted = await readActiveSession(raw.sessionId, user.id);
  assert.equal(persisted?.deviceLabel, null);
});
