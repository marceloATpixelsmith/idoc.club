import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const session = readFileSync('lib/auth/session.ts', 'utf8');
const tokens = readFileSync('lib/auth/session-tokens.ts', 'utf8');
const middleware = readFileSync('middleware.ts', 'utf8');
const queries = readFileSync('lib/db/queries.ts', 'utf8');
const actions = readFileSync('app/(login)/actions.ts', 'utf8');

test('session lifetime matches the canonical 30-minute idle and 12-hour absolute bounds', () => {
  assert.match(tokens, /SESSION_IDLE_SECONDS = 30 \* 60/);
  assert.match(tokens, /SESSION_ABSOLUTE_SECONDS = 12 \* 60 \* 60/);
  assert.match(tokens, /Session idle lifetime expired/);
  assert.match(tokens, /Session absolute lifetime expired/);
  assert.match(tokens, /absoluteExpiresAtMs !== authenticatedAtMs \+ SESSION_ABSOLUTE_SECONDS \* 1000/);
});

test('production session cookie uses host-only canonical security attributes', () => {
  assert.match(tokens, /PRODUCTION_SESSION_COOKIE_NAME = '__Host-idoc-session'/);
  assert.match(tokens, /httpOnly: true/);
  assert.match(tokens, /sameSite: 'lax'/);
  assert.match(tokens, /path: '\/'/);
  assert.match(tokens, /secure: environment\.NODE_ENV === 'production'/);
  assert.doesNotMatch(tokens, /domain:/);
});

test('canonical session clearing preserves __Host cookie attributes', () => {
  assert.match(tokens, /expiredSessionCookieOptions/);
  assert.match(tokens, /expires: new Date\(0\)/);
  assert.match(tokens, /maxAge: 0/);
  assert.match(session, /cookieStore\.set\(sessionCookieName\(environment\), '', expiredSessionCookieOptions\(environment\)\)/);
  assert.doesNotMatch(session, /cookieStore\.delete\(sessionCookieName\(/);
  assert.match(middleware, /res\.cookies\.set\(\{ name: canonicalName, value: '', \.\.\.expiredSessionCookieOptions\(\) \}\)/);
  assert.doesNotMatch(middleware, /res\.cookies\.delete\(canonicalName\)/);
});

test('middleware refreshes idle activity without extending the absolute authentication lifetime', () => {
  assert.match(middleware, /refreshSessionActivity\(parsed\)/);
  assert.match(middleware, /sessionCookieOptions\(refreshed\.absoluteExpiresAt\)/);
  assert.doesNotMatch(middleware, /24 \* 60 \* 60|expiresInOneDay/);
  assert.match(tokens, /return \{ \.\.\.session, lastActivityAt: now\.toISOString\(\) \}/);
  assert.doesNotMatch(tokens, /absoluteExpiresAt: new Date\(now\.getTime\(\) \+ SESSION_ABSOLUTE_SECONDS \* 1000\).*refreshSessionActivity/s);
});

test('new authentication rotates to a distinct session identifier and fixed absolute deadline', () => {
  assert.match(session, /sessionId: randomUUID\(\)/);
  assert.match(session, /authenticatedAt: now\.toISOString\(\)/);
  assert.match(session, /absoluteExpiresAt: new Date\(now\.getTime\(\) \+ SESSION_ABSOLUTE_SECONDS \* 1000\)/);
});

test('the legacy pre-retrofit cookie is never accepted as authentication authority, only ever defensively cleared', () => {
  // A signed JWT alone is never sufficient authentication authority: neither getSession() nor
  // middleware.ts reads LEGACY_SESSION_COOKIE_NAME for anything but deletion, and
  // normalizeSessionPayload no longer reinterprets a legacy-shaped payload as a valid session at all.
  assert.match(tokens, /LEGACY_SESSION_COOKIE_NAME = 'session'/);
  assert.doesNotMatch(tokens, /One-way compatibility input for the pre-canonical cookie/);
  assert.match(tokens, /payload\.version !== 2 \|\|/);

  assert.match(middleware, /const legacyCookie = request\.cookies\.get\(LEGACY_SESSION_COOKIE_NAME\);/);
  assert.doesNotMatch(middleware, /canonicalCookie \?\? legacyCookie/);
  assert.match(middleware, /if \(legacyCookie\) res\.cookies\.delete\(LEGACY_SESSION_COOKIE_NAME\);/);

  assert.doesNotMatch(session, /cookieStore\.get\(LEGACY_SESSION_COOKIE_NAME\)\?\.value/);
  assert.match(session, /cookieStore\.delete\(LEGACY_SESSION_COOKIE_NAME\)/);

  assert.match(actions, /export async function signOut\(\) \{\s*await clearSession\(\);\s*\}/s);
});

test('authenticated user resolution uses the canonical freshness validator and authoritative sessionVersion', () => {
  assert.match(queries, /const sessionData = await getSession\(\)/);
  assert.match(queries, /user\[0\]\.sessionVersion !== sessionData\.user\.sessionVersion/);
  assert.doesNotMatch(queries, /new Date\(sessionData\.expires\)/);
});
