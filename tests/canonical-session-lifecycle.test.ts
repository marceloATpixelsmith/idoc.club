import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const session = readFileSync('lib/auth/session.ts', 'utf8');
const middleware = readFileSync('middleware.ts', 'utf8');
const queries = readFileSync('lib/db/queries.ts', 'utf8');
const actions = readFileSync('app/(login)/actions.ts', 'utf8');

test('session lifetime matches the canonical 30-minute idle and 12-hour absolute bounds', () => {
  assert.match(session, /SESSION_IDLE_SECONDS = 30 \* 60/);
  assert.match(session, /SESSION_ABSOLUTE_SECONDS = 12 \* 60 \* 60/);
  assert.match(session, /Session idle lifetime expired/);
  assert.match(session, /Session absolute lifetime expired/);
  assert.match(session, /absoluteExpiresAtMs !== authenticatedAtMs \+ SESSION_ABSOLUTE_SECONDS \* 1000/);
});

test('production session cookie uses host-only canonical security attributes', () => {
  assert.match(session, /PRODUCTION_SESSION_COOKIE_NAME = '__Host-idoc-session'/);
  assert.match(session, /httpOnly: true/);
  assert.match(session, /sameSite: 'lax'/);
  assert.match(session, /path: '\/'/);
  assert.match(session, /secure: process\.env\.NODE_ENV === 'production'/);
  assert.doesNotMatch(session, /domain:/);
});

test('canonical session clearing preserves __Host cookie attributes', () => {
  assert.match(session, /expiredSessionCookieOptions/);
  assert.match(session, /expires: new Date\(0\)/);
  assert.match(session, /maxAge: 0/);
  assert.match(session, /cookieStore\.set\(sessionCookieName\(\), '', expiredSessionCookieOptions\(\)\)/);
  assert.doesNotMatch(session, /cookieStore\.delete\(sessionCookieName\(\)\)/);
  assert.match(middleware, /res\.cookies\.set\(\{ name: canonicalName, value: '', \.\.\.expiredSessionCookieOptions\(\) \}\)/);
  assert.doesNotMatch(middleware, /res\.cookies\.delete\(canonicalName\)/);
});

test('middleware refreshes idle activity without extending the absolute authentication lifetime', () => {
  assert.match(middleware, /refreshSessionActivity\(parsed\)/);
  assert.match(middleware, /sessionCookieOptions\(refreshed\.absoluteExpiresAt\)/);
  assert.doesNotMatch(middleware, /24 \* 60 \* 60|expiresInOneDay/);
  assert.match(session, /return \{ \.\.\.session, lastActivityAt: now\.toISOString\(\) \}/);
  assert.doesNotMatch(session, /absoluteExpiresAt: new Date\(now\.getTime\(\) \+ SESSION_ABSOLUTE_SECONDS \* 1000\).*refreshSessionActivity/s);
});

test('new authentication rotates to a distinct session identifier and fixed absolute deadline', () => {
  assert.match(session, /sessionId: randomUUID\(\)/);
  assert.match(session, /authenticatedAt: now\.toISOString\(\)/);
  assert.match(session, /absoluteExpiresAt: new Date\(now\.getTime\(\) \+ SESSION_ABSOLUTE_SECONDS \* 1000\)/);
});

test('legacy one-day cookie is only a one-way compatibility input and is removed on upgrade/sign-out', () => {
  assert.match(session, /LEGACY_SESSION_COOKIE_NAME = 'session'/);
  assert.match(session, /One-way compatibility bridge/);
  assert.match(middleware, /if \(legacyCookie\) res\.cookies\.delete\(LEGACY_SESSION_COOKIE_NAME\)/);
  assert.match(actions, /export async function signOut\(\) \{\s*await clearSession\(\);\s*\}/s);
  assert.match(session, /cookieStore\.delete\(LEGACY_SESSION_COOKIE_NAME\)/);
});

test('authenticated user resolution uses the canonical freshness validator and authoritative sessionVersion', () => {
  assert.match(queries, /const sessionData = await getSession\(\)/);
  assert.match(queries, /user\[0\]\.sessionVersion !== sessionData\.user\.sessionVersion/);
  assert.doesNotMatch(queries, /new Date\(sessionData\.expires\)/);
});
