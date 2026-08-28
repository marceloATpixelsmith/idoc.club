import assert from 'node:assert/strict';
import test from 'node:test';
import { SignJWT } from 'jose';
import {
  DEVELOPMENT_SESSION_COOKIE_NAME,
  PRODUCTION_SESSION_COOKIE_NAME,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
  type SessionData,
  assertSessionFresh,
  expiredSessionCookieOptions,
  refreshSessionActivity,
  sessionCookieName,
  sessionCookieOptions,
  signToken,
  verifyToken,
} from '../lib/auth/session-tokens.ts';

process.env.AUTH_SECRET ??= 'security-e2e-only-auth-secret-32-bytes';

function freshSession(overrides: Partial<SessionData> = {}, authenticatedAt = new Date()): SessionData {
  const authenticatedAtIso = authenticatedAt.toISOString();
  return {
    version: 2,
    sessionId: 'session-under-test',
    user: { id: 1, sessionVersion: 0 },
    authenticatedAt: authenticatedAtIso,
    lastActivityAt: authenticatedAtIso,
    absoluteExpiresAt: new Date(authenticatedAt.getTime() + SESSION_ABSOLUTE_SECONDS * 1000).toISOString(),
    ...overrides,
  };
}

// --- Idle timeout: exact boundary -------------------------------------------------------------

test('a session one second inside the 30-minute idle window is accepted', () => {
  const authenticatedAt = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date(authenticatedAt.getTime() + (SESSION_IDLE_SECONDS - 1) * 1000);
  const session = freshSession({ lastActivityAt: authenticatedAt.toISOString() }, authenticatedAt);
  assert.doesNotThrow(() => assertSessionFresh(session, now));
});

test('a session exactly at the 30-minute idle boundary is rejected', () => {
  const authenticatedAt = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date(authenticatedAt.getTime() + SESSION_IDLE_SECONDS * 1000);
  const session = freshSession({ lastActivityAt: authenticatedAt.toISOString() }, authenticatedAt);
  assert.throws(() => assertSessionFresh(session, now), /Session idle lifetime expired/);
});

test('a session one second past the 30-minute idle boundary is rejected', () => {
  const authenticatedAt = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date(authenticatedAt.getTime() + (SESSION_IDLE_SECONDS + 1) * 1000);
  const session = freshSession({ lastActivityAt: authenticatedAt.toISOString() }, authenticatedAt);
  assert.throws(() => assertSessionFresh(session, now), /Session idle lifetime expired/);
});

// --- Absolute timeout: exact boundary ---------------------------------------------------------

test('a session one second inside the 12-hour absolute window is accepted', () => {
  const authenticatedAt = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date(authenticatedAt.getTime() + (SESSION_ABSOLUTE_SECONDS - 1) * 1000);
  const session = freshSession({ lastActivityAt: now.toISOString() }, authenticatedAt);
  assert.doesNotThrow(() => assertSessionFresh(session, now));
});

test('a session exactly at the 12-hour absolute boundary is rejected', () => {
  const authenticatedAt = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date(authenticatedAt.getTime() + SESSION_ABSOLUTE_SECONDS * 1000);
  const session = freshSession({ lastActivityAt: authenticatedAt.toISOString() }, authenticatedAt);
  assert.throws(() => assertSessionFresh(session, now), /Session absolute lifetime expired/);
});

test('absolute expiration is checked before idle expiration and cannot be bypassed by recent activity', () => {
  const authenticatedAt = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date(authenticatedAt.getTime() + SESSION_ABSOLUTE_SECONDS * 1000 + 1000);
  // lastActivityAt is "now" itself (maximally fresh) — absolute expiry still fails closed.
  const session = freshSession({ lastActivityAt: now.toISOString() }, authenticatedAt);
  assert.throws(() => assertSessionFresh(session, now), /Session absolute lifetime expired/);
});

// --- Idle activity refresh never slides the absolute deadline ---------------------------------

test('refreshSessionActivity advances lastActivityAt but never absoluteExpiresAt', () => {
  const authenticatedAt = new Date('2026-01-01T00:00:00.000Z');
  const session = freshSession({}, authenticatedAt);
  const laterNow = new Date(authenticatedAt.getTime() + 10 * 60 * 1000);
  const refreshed = refreshSessionActivity(session, laterNow);
  assert.equal(refreshed.lastActivityAt, laterNow.toISOString());
  assert.equal(refreshed.absoluteExpiresAt, session.absoluteExpiresAt);
  assert.equal(refreshed.authenticatedAt, session.authenticatedAt);
});

test('repeated activity refreshes keep the session alive past the original idle window but never past the absolute cap', () => {
  const authenticatedAt = new Date('2026-01-01T00:00:00.000Z');
  let session = freshSession({}, authenticatedAt);
  // Refresh every 20 minutes (inside the 30-minute idle window each time) for 11 hours.
  let clock = authenticatedAt.getTime();
  for (let i = 0; i < 33; i += 1) {
    clock += 20 * 60 * 1000;
    session = refreshSessionActivity(session, new Date(clock));
  }
  assert.doesNotThrow(() => assertSessionFresh(session, new Date(clock)));
  // One more idle-window's worth of silence past the last refresh, still inside the absolute cap.
  const idleOut = new Date(clock + SESSION_IDLE_SECONDS * 1000);
  assert.throws(() => assertSessionFresh(session, idleOut), /Session idle lifetime expired/);
  // And the absolute cap fires even if activity had continued right up to it.
  const stillFresh = refreshSessionActivity(session, new Date(clock));
  const pastAbsolute = new Date(new Date(stillFresh.absoluteExpiresAt).getTime());
  assert.throws(() => assertSessionFresh(stillFresh, pastAbsolute), /Session absolute lifetime expired/);
});

// --- JWT round trip, tampering, and malformed input --------------------------------------------

test('a session signed and verified round-trips exactly', async () => {
  // signToken/verifyToken both default `now` to the real wall clock, so this session must be
  // anchored to the actual present rather than a fixed historical date (unlike the boundary tests
  // above, which inject an explicit `now` and can use any fixed date).
  const authenticatedAt = new Date();
  const session = freshSession({}, authenticatedAt);
  const token = await signToken(session);
  const verified = await verifyToken(token);
  assert.deepEqual(verified, session);
});

test('a malformed (non-JWT) token is rejected', async () => {
  await assert.rejects(() => verifyToken('this-is-not-a-jwt'));
  await assert.rejects(() => verifyToken(''));
});

test('a token signed with a different secret is rejected (invalid signature)', async () => {
  const authenticatedAt = new Date('2026-01-01T00:00:00.000Z');
  const payload = freshSession({}, authenticatedAt);
  const forged = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(new Date(payload.absoluteExpiresAt).getTime() / 1000))
    .sign(new TextEncoder().encode('a-completely-different-32-byte-secret-value'));
  await assert.rejects(() => verifyToken(forged, authenticatedAt));
});

test('a token signed with an unsupported algorithm is rejected even with the correct secret', async () => {
  const authenticatedAt = new Date('2026-01-01T00:00:00.000Z');
  const payload = freshSession({}, authenticatedAt);
  const key = new TextEncoder().encode(process.env.AUTH_SECRET);
  const forged = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS384' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(new Date(payload.absoluteExpiresAt).getTime() / 1000))
    .sign(key);
  await assert.rejects(() => verifyToken(forged, authenticatedAt), /alg/i);
});

test('a token already expired per its own exp claim is rejected even before freshness checks run', async () => {
  const authenticatedAt = new Date('2026-01-01T00:00:00.000Z');
  const payload = freshSession({}, authenticatedAt);
  const key = new TextEncoder().encode(process.env.AUTH_SECRET);
  const forged = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(authenticatedAt.getTime() / 1000) - 10)
    .sign(key);
  await assert.rejects(() => verifyToken(forged, authenticatedAt), /exp/i);
});

test('a payload missing the user identity is rejected', async () => {
  const key = new TextEncoder().encode(process.env.AUTH_SECRET);
  const forged = await new SignJWT({ version: 2, sessionId: 'x' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(key);
  await assert.rejects(() => verifyToken(forged), /Invalid session identity payload/);
});

test('a payload with neither a canonical version-2 shape nor a legacy iat claim is rejected', async () => {
  // jose's SignJWT normally auto-sets iat via setIssuedAt(); omit it to exercise the true reject path.
  const key = new TextEncoder().encode(process.env.AUTH_SECRET);
  const forged = await new SignJWT({ user: { id: 1, sessionVersion: 0 } })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(key);
  await assert.rejects(() => verifyToken(forged), /Unsupported session payload/);
});

test('a payload with the wrong version number falls back to the legacy compatibility shape rather than being hard-rejected', async () => {
  // This documents actual, verified behavior: normalizeSessionPayload's version check is not a hard
  // reject — any payload short of the exact version-2 shape that still carries `iat` and `user` is
  // reinterpreted as a legacy one-way compatibility session with a synthesized 12-hour absolute cap.
  const key = new TextEncoder().encode(process.env.AUTH_SECRET);
  const beforeSign = Math.floor(Date.now() / 1000);
  const forged = await new SignJWT({ version: 1, user: { id: 7, sessionVersion: 3 } })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(beforeSign + SESSION_ABSOLUTE_SECONDS)
    .sign(key);
  const verified = await verifyToken(forged, new Date());
  assert.equal(verified.user.id, 7);
  assert.equal(verified.user.sessionVersion, 3);
  assert.match(verified.sessionId, /^legacy-\d+-7$/);
  assert.equal(
    new Date(verified.absoluteExpiresAt).getTime(),
    new Date(verified.authenticatedAt).getTime() + SESSION_ABSOLUTE_SECONDS * 1000,
  );
});

// --- Production vs development cookie contract (environment-injected, no process.env mutation) --

test('cookie name is host-only only in production; secure only in production; no Domain attribute ever', () => {
  assert.equal(sessionCookieName({ NODE_ENV: 'production' }), PRODUCTION_SESSION_COOKIE_NAME);
  assert.equal(sessionCookieName({ NODE_ENV: 'development' }), DEVELOPMENT_SESSION_COOKIE_NAME);
  assert.equal(sessionCookieName({}), DEVELOPMENT_SESSION_COOKIE_NAME);

  const prodOptions = sessionCookieOptions(new Date(Date.now() + 1000).toISOString(), { NODE_ENV: 'production' });
  assert.equal(prodOptions.secure, true);
  assert.equal(prodOptions.httpOnly, true);
  assert.equal(prodOptions.sameSite, 'lax');
  assert.equal(prodOptions.path, '/');
  assert.ok(!('domain' in prodOptions));

  const devOptions = sessionCookieOptions(new Date(Date.now() + 1000).toISOString(), { NODE_ENV: 'development' });
  assert.equal(devOptions.secure, false);
});

test('the cleared/expired cookie carries production security attributes when production, and always zeroes lifetime', () => {
  const prodCleared = expiredSessionCookieOptions({ NODE_ENV: 'production' });
  assert.equal(prodCleared.secure, true);
  assert.equal(prodCleared.maxAge, 0);
  assert.equal(prodCleared.expires.getTime(), 0);

  const devCleared = expiredSessionCookieOptions({ NODE_ENV: 'development' });
  assert.equal(devCleared.secure, false);
  assert.equal(devCleared.maxAge, 0);
});
