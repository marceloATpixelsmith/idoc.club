import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  listActiveSessions,
  readActiveSession,
  registerSession,
  revokeSession,
  touchSession,
} from '../lib/auth/session-registry.ts';
import { SESSION_IDLE_SECONDS } from '../lib/auth/session-tokens.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

function absoluteExpiryFrom(now: Date) {
  return new Date(now.getTime() + 12 * 60 * 60 * 1000);
}

async function registerFixtureSession(userId: number, sessionVersion = 0) {
  const sessionId = randomUUID();
  const now = new Date();
  await registerSession({
    sessionId,
    userId,
    sessionVersion,
    authenticatedAt: now,
    lastActivityAt: now,
    absoluteExpiresAt: absoluteExpiryFrom(now),
  });
  return { sessionId, now };
}

test('an unregistered session id is never returned as active (missing persisted row is rejected)', async () => {
  await resetIdoc();
  const user = await createUser();
  const neverRegisteredSessionId = randomUUID();
  const record = await readActiveSession(neverRegisteredSessionId, user.id);
  assert.equal(record, null);
});

test('a registered session for a different user id is not returned as active', async () => {
  await resetIdoc();
  const owner = await createUser();
  const attacker = await createUser();
  const { sessionId } = await registerFixtureSession(owner.id);
  assert.equal(await readActiveSession(sessionId, attacker.id), null);
  assert.ok(await readActiveSession(sessionId, owner.id));
});

test('a revoked session is no longer returned as active, and the revocation timestamp is actually persisted', async () => {
  await resetIdoc();
  const user = await createUser();
  const { sessionId } = await registerFixtureSession(user.id);
  assert.ok(await readActiveSession(sessionId, user.id), 'sanity: session starts active');

  await revokeSession(sessionId, user.id, 'user-signout');

  assert.equal(await readActiveSession(sessionId, user.id), null);
  const [row] = await sql<{ revoked_at: Date | null; revoke_reason: string | null }[]>`
    select revoked_at, revoke_reason from idoc.auth_sessions where session_id = ${sessionId}`;
  assert.ok(row.revoked_at, 'revoked_at must actually be persisted, not merely implied');
  assert.equal(row.revoke_reason, 'user-signout');
});

test('revocation rejects replay regardless of which reason string was recorded', async () => {
  await resetIdoc();
  const user = await createUser();
  for (const reason of ['user-signout', 'account-deleted', 'member-security-session-signout', 'a-completely-novel-reason']) {
    const { sessionId } = await registerFixtureSession(user.id);
    await revokeSession(sessionId, user.id, reason);
    assert.equal(await readActiveSession(sessionId, user.id), null, `reason=${reason} must still deny access`);
  }
});

test('revoking an already-revoked session preserves the original revocation reason (first reason wins, not last)', async () => {
  await resetIdoc();
  const user = await createUser();
  const { sessionId } = await registerFixtureSession(user.id);
  await revokeSession(sessionId, user.id, 'user-signout');
  await revokeSession(sessionId, user.id, 'account-deleted');
  const [row] = await sql<{ revoke_reason: string }[]>`
    select revoke_reason from idoc.auth_sessions where session_id = ${sessionId}`;
  assert.equal(row.revoke_reason, 'user-signout');
});

test('touchSession cannot resurrect a revoked session: the activity update is silently rejected and the row stays inactive', async () => {
  await resetIdoc();
  const user = await createUser();
  const { sessionId } = await registerFixtureSession(user.id);
  await revokeSession(sessionId, user.id, 'user-signout');
  const [before] = await sql<{ last_activity_at: Date }[]>`
    select last_activity_at from idoc.auth_sessions where session_id = ${sessionId}`;

  const attemptedTouch = new Date(Date.now() + 60_000);
  await touchSession(sessionId, user.id, attemptedTouch);

  assert.equal(await readActiveSession(sessionId, user.id), null, 'still inactive after the touch attempt');
  const [after] = await sql<{ last_activity_at: Date }[]>`
    select last_activity_at from idoc.auth_sessions where session_id = ${sessionId}`;
  assert.equal(new Date(after.last_activity_at).getTime(), new Date(before.last_activity_at).getTime(), 'activity timestamp must not move on a revoked row');
});

test('a session past its persisted absolute expiry is not returned as active even though revoked_at is null', async () => {
  await resetIdoc();
  const user = await createUser();
  const sessionId = randomUUID();
  const now = new Date();
  const alreadyExpired = new Date(now.getTime() - 1000);
  await registerSession({
    sessionId,
    userId: user.id,
    sessionVersion: 0,
    authenticatedAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
    lastActivityAt: now,
    absoluteExpiresAt: alreadyExpired,
  });
  assert.equal(await readActiveSession(sessionId, user.id), null);
  const [row] = await sql<{ revoked_at: Date | null }[]>`
    select revoked_at from idoc.auth_sessions where session_id = ${sessionId}`;
  assert.equal(row.revoked_at, null, 'idle/absolute aging-out is a query-time filter, not an explicit revocation');
});

test('a concurrent revoke racing a touch always leaves the session inactive, regardless of ordering', async () => {
  await resetIdoc();
  const user = await createUser();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { sessionId } = await registerFixtureSession(user.id);
    await Promise.allSettled([
      revokeSession(sessionId, user.id, 'concurrent-race'),
      touchSession(sessionId, user.id, new Date(Date.now() + 1000)),
    ]);
    assert.equal(await readActiveSession(sessionId, user.id), null, `attempt ${attempt}: revoke must win the race`);
  }
});

test('registerSession is idempotent on a duplicate session id (on conflict do nothing) rather than overwriting an existing row', async () => {
  await resetIdoc();
  const user = await createUser();
  const sessionId = randomUUID();
  const now = new Date();
  await registerSession({
    sessionId, userId: user.id, sessionVersion: 0,
    authenticatedAt: now, lastActivityAt: now, absoluteExpiresAt: absoluteExpiryFrom(now),
  });
  await revokeSession(sessionId, user.id, 'user-signout');
  // A second registration attempt with the same session id (e.g. a retried request) must not
  // resurrect a revoked row by silently overwriting it.
  await registerSession({
    sessionId, userId: user.id, sessionVersion: 0,
    authenticatedAt: now, lastActivityAt: now, absoluteExpiresAt: absoluteExpiryFrom(now),
  });
  assert.equal(await readActiveSession(sessionId, user.id), null);
});

test('the security page session list excludes a session that has gone idle-stale, even hours before its absolute expiry', async () => {
  // A real production report: an account that had signed in and out repeatedly on one browser in a
  // single day saw far more "active sessions" than it had ever actually had live at once. Each of
  // those earlier logins is still within its 12-hour absolute window, but none of them are usable
  // any more once idle past SESSION_IDLE_SECONDS -- the list must reflect that, not just the fixed
  // absolute deadline.
  await resetIdoc();
  const user = await createUser();
  const now = new Date();

  const stillIdleWithinWindow = randomUUID();
  await registerSession({ sessionId: stillIdleWithinWindow, userId: user.id, sessionVersion: 0,
    authenticatedAt: new Date(now.getTime() - SESSION_IDLE_SECONDS * 500), lastActivityAt: now,
    absoluteExpiresAt: absoluteExpiryFrom(now) });

  const idleStale = randomUUID();
  const staleLastActivity = new Date(now.getTime() - (SESSION_IDLE_SECONDS + 60) * 1000);
  await registerSession({ sessionId: idleStale, userId: user.id, sessionVersion: 0,
    authenticatedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), lastActivityAt: staleLastActivity,
    // Still hours away from its own absolute deadline -- only idle staleness should exclude it.
    absoluteExpiresAt: absoluteExpiryFrom(staleLastActivity) });

  const active = await listActiveSessions(user.id, 0);
  const ids = active.map((session) => session.sessionId);
  assert.ok(ids.includes(stillIdleWithinWindow), 'a recently-touched session must still be listed');
  assert.ok(!ids.includes(idleStale), 'a session idle past SESSION_IDLE_SECONDS must not be listed, regardless of its absolute expiry');

  const [staleRow] = await sql<{ revoked_at: Date | null }[]>`
    select revoked_at from idoc.auth_sessions where session_id = ${idleStale}`;
  assert.equal(staleRow.revoked_at, null, 'idle exclusion from the list is a query-time filter, not an explicit revocation');
});

test.after(closeHarness);
