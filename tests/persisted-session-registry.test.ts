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

  const getSessionStart = session.indexOf('export async function getSession()');
  const notCanonical = session.indexOf('if (!canonicalValue) return null;', getSessionStart);
  const registryValidation = session.indexOf('return (await registeredSessionIsValid(session)) ? session : null;', notCanonical);
  assert.ok(getSessionStart >= 0 && notCanonical > getSessionStart && registryValidation > notCanonical);

  const tokenValidationBlock = session.slice(notCanonical, registryValidation);
  assert.match(tokenValidationBlock, /session = await verifyToken\(canonicalValue\);/);
  assert.match(tokenValidationBlock, /catch \{\s*return null;\s*\}/);

  // getSession() never accepts a legacy-shaped or legacy-cookie session at all -- there is no
  // second, un-registry-checked return path after the canonical registry validation above.
  const afterRegistryCheck = session.slice(registryValidation + 'return (await registeredSessionIsValid(session)) ? session : null;'.length);
  const nextFunctionStart = afterRegistryCheck.indexOf('export async function setSession');
  const restOfGetSession = afterRegistryCheck.slice(0, nextFunctionStart);
  assert.doesNotMatch(restOfGetSession, /legacyValue|LEGACY_SESSION_COOKIE_NAME/);
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

test('a signed JWT alone is never sufficient authentication authority: legacy cookies are never accepted, only defensively cleared', () => {
  // middleware.ts: only the canonical cookie is ever read into `canonicalCookie`/verified/refreshed;
  // the legacy cookie is looked up solely to delete it on every response path (`finish()`).
  assert.doesNotMatch(middleware, /canonicalCookie \?\? legacyCookie/);
  assert.match(middleware, /const legacyCookie = request\.cookies\.get\(LEGACY_SESSION_COOKIE_NAME\);/);
  assert.match(middleware, /if \(legacyCookie\) res\.cookies\.delete\(LEGACY_SESSION_COOKIE_NAME\);/);
  assert.match(middleware, /const parsed = await verifyToken\(canonicalCookie\.value\);/);

  // lib/auth/session-tokens.ts: normalizeSessionPayload hard-rejects anything short of the exact
  // version-2 shape -- no more one-way "legacy compatibility" reinterpretation of a bare {user, iat}
  // payload into a session with a synthesized, never-persisted sessionId.
  assert.doesNotMatch(tokens, /legacy-\$\{/);
  assert.doesNotMatch(tokens, /One-way compatibility input for the pre-canonical cookie/);
  assert.match(tokens, /payload\.version !== 2 \|\|/);
  assert.match(tokens, /throw new Error\('Unsupported session payload\.'\);/);
});

test('migration creates an indexed server-side session registry without touching billing tables', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "idoc"\."auth_sessions"/);
  assert.match(migration, /"session_id" varchar\(64\) NOT NULL/);
  assert.match(migration, /"revoked_at" timestamp with time zone/);
  assert.match(migration, /auth_sessions_active_user_idx/);
  assert.doesNotMatch(migration, /stripe|billing|subscription|payment/i);
});
