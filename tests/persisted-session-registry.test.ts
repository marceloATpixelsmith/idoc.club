import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const session = readFileSync('lib/auth/session.ts', 'utf8');
const tokens = readFileSync('lib/auth/session-tokens.ts', 'utf8');
const registry = readFileSync('lib/auth/session-registry.ts', 'utf8');
const middleware = readFileSync('middleware.ts', 'utf8');
const migration = readFileSync('lib/db/migrations/0016_persisted_auth_sessions.sql', 'utf8');

test('new canonical sessions are persisted before the cookie is issued', () => {
  const register = session.indexOf('await registerSession({');
  const cookie = session.indexOf('cookieStore.set(sessionCookieName()');
  assert.ok(register >= 0 && cookie > register);
  assert.match(session, /sessionId: randomUUID\(\)/);
});

test('canonical cookie authentication requires an active persisted registry row without hiding database failures', () => {
  assert.match(session, /readActiveSession\(session\.sessionId, session\.user\.id\)/);
  assert.match(session, /if \(!record\) return false/);
  assert.match(session, /await touchSession\(session\.sessionId, session\.user\.id, now\)/);

  const canonicalStart = session.indexOf('if (canonicalValue) {');
  const registryValidation = session.indexOf('return (await registeredSessionIsValid(session)) ? session : null;', canonicalStart);
  const legacyStart = session.indexOf('const legacyValue =', registryValidation);
  assert.ok(canonicalStart >= 0 && registryValidation > canonicalStart && legacyStart > registryValidation);

  const tokenValidationBlock = session.slice(canonicalStart, registryValidation);
  assert.match(tokenValidationBlock, /session = await verifyToken\(canonicalValue\);/);
  assert.match(tokenValidationBlock, /catch \{\s*return null;\s*\}/);

  const registryValidationBlock = session.slice(registryValidation, legacyStart);
  assert.doesNotMatch(registryValidationBlock, /catch\s*\{/);
});

test('sign-out revokes the current persisted session before clearing the cookie and propagates revocation failure', () => {
  const revoke = session.indexOf("await revokeSession(session.sessionId, session.user.id, 'user-signout')");
  const clear = session.indexOf("cookieStore.set(sessionCookieName(), '', expiredSessionCookieOptions())");
  assert.ok(revoke >= 0 && clear > revoke);
  assert.match(session, /if \(session\) \{[\s\S]*?await revokeSession\(session\.sessionId, session\.user\.id, 'user-signout'\);[\s\S]*?\}/);
  assert.doesNotMatch(session, /try \{[\s\S]*?await revokeSession\(session\.sessionId, session\.user\.id, 'user-signout'\);[\s\S]*?catch/);
});

test('registry exposes individual and all-session revocation plus inventory primitives', () => {
  assert.match(registry, /export async function revokeSession\(/);
  assert.match(registry, /export async function revokeAllUserSessions\(/);
  assert.match(registry, /export async function revokeOtherUserSessions\(/);
  assert.match(registry, /export async function listActiveSessions\(/);
  assert.match(registry, /revoked_at is null/);
  assert.match(registry, /absolute_expires_at > now\(\)/);
});

test('legacy cookies never get promoted into the canonical registry namespace', () => {
  assert.match(middleware, /request\.method === 'GET' && canonicalCookie/);
  const refreshBranch = middleware.match(/if \(request\.method === 'GET' && canonicalCookie\) \{([\s\S]*?)\n    \}/)?.[1] ?? '';
  assert.match(refreshBranch, /name: canonicalName/);
  assert.doesNotMatch(refreshBranch, /legacyCookie|LEGACY_SESSION_COOKIE_NAME/);
  assert.match(tokens, /One-way compatibility input for the pre-canonical cookie/);
});

test('migration creates an indexed server-side session registry without touching billing tables', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "idoc"\."auth_sessions"/);
  assert.match(migration, /"session_id" varchar\(64\) NOT NULL/);
  assert.match(migration, /"revoked_at" timestamp with time zone/);
  assert.match(migration, /auth_sessions_active_user_idx/);
  assert.doesNotMatch(migration, /stripe|billing|subscription|payment/i);
});
