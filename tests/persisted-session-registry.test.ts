import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const session = readFileSync('lib/auth/session.ts', 'utf8');
const registry = readFileSync('lib/auth/session-registry.ts', 'utf8');
const middleware = readFileSync('middleware.ts', 'utf8');
const migration = readFileSync('lib/db/migrations/0016_persisted_auth_sessions.sql', 'utf8');

test('new canonical sessions are persisted before the cookie is issued', () => {
  const register = session.indexOf('await registerSession({');
  const cookie = session.indexOf('cookieStore.set(sessionCookieName()');
  assert.ok(register >= 0 && cookie > register);
  assert.match(session, /sessionId: randomUUID\(\)/);
});

test('canonical cookie authentication requires an active persisted registry row', () => {
  assert.match(session, /readActiveSession\(session\.sessionId, session\.user\.id\)/);
  assert.match(session, /Session is not active in the server registry/);
  assert.match(session, /Session version mismatch/);
  assert.match(session, /Session absolute deadline mismatch/);
  assert.match(session, /await assertRegisteredSession\(session\)/);
});

test('sign-out revokes the current persisted session before clearing the cookie', () => {
  const revoke = session.indexOf("await revokeSession(session.sessionId, session.user.id, 'user-signout')");
  const clear = session.indexOf("cookieStore.set(sessionCookieName(), '', expiredSessionCookieOptions())");
  assert.ok(revoke >= 0 && clear > revoke);
});

test('registry exposes individual and all-session revocation plus inventory primitives', () => {
  assert.match(registry, /export async function revokeSession\(/);
  assert.match(registry, /export async function revokeAllUserSessions\(/);
  assert.match(registry, /export async function listActiveSessions\(/);
  assert.match(registry, /revoked_at is null/);
  assert.match(registry, /absolute_expires_at > now\(\)/);
});

test('legacy cookies never get promoted into the canonical registry namespace', () => {
  assert.match(middleware, /request\.method === 'GET' && canonicalCookie/);
  assert.doesNotMatch(middleware, /if \(legacyCookie\) res\.cookies\.delete\(LEGACY_SESSION_COOKIE_NAME\)/);
  assert.match(session, /Temporary compatibility only for the pre-canonical cookie/);
});

test('migration creates an indexed server-side session registry without touching billing tables', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "idoc"\."auth_sessions"/);
  assert.match(migration, /"session_id" varchar\(64\) NOT NULL/);
  assert.match(migration, /"revoked_at" timestamp with time zone/);
  assert.match(migration, /auth_sessions_active_user_idx/);
  assert.doesNotMatch(migration, /stripe|billing|subscription|payment/i);
});
