import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  listActiveSessions,
  registerSession,
  sessionVersionIsCurrent,
  userHasPrivilegedRole,
} from '../lib/auth/session-registry.ts';
import {
  MEMBER_SESSION_ABSOLUTE_SECONDS,
  MEMBER_SESSION_IDLE_SECONDS,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
} from '../lib/auth/session-tokens.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

test('role lookup distinguishes ordinary members from active administrators', async () => {
  await resetIdoc();
  const member = await createUser();
  const admin = await createUser();

  await sql`
    insert into idoc.application_roles(user_id, role, granted_by)
    values(${admin.id}, 'administrator', ${admin.id})
  `;

  assert.equal(await userHasPrivilegedRole(member.id), false);
  assert.equal(await userHasPrivilegedRole(admin.id), true);
});

test('active-session listing uses 7-day idle window for ordinary members and 30 minutes for privileged users', async () => {
  await resetIdoc();
  const member = await createUser();
  const admin = await createUser();

  await sql`
    insert into idoc.application_roles(user_id, role, granted_by)
    values(${admin.id}, 'administrator', ${admin.id})
  `;

  const now = new Date();
  const memberSessionId = randomUUID();
  const adminSessionId = randomUUID();

  await registerSession({
    sessionId: memberSessionId,
    userId: member.id,
    sessionVersion: 0,
    authenticatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    lastActivityAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    absoluteExpiresAt: new Date(now.getTime() + MEMBER_SESSION_ABSOLUTE_SECONDS * 1000 - 24 * 60 * 60 * 1000),
  });

  await registerSession({
    sessionId: adminSessionId,
    userId: admin.id,
    sessionVersion: 0,
    authenticatedAt: new Date(now.getTime() - 60 * 60 * 1000),
    lastActivityAt: new Date(now.getTime() - 60 * 60 * 1000),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_SECONDS * 1000 - 60 * 60 * 1000),
  });

  const memberSessions = await listActiveSessions(member.id, 0);
  const adminSessions = await listActiveSessions(admin.id, 0);

  assert.ok(memberSessions.some((session) => session.sessionId === memberSessionId),
    'ordinary member session idle for one day should still be listed as active');
  assert.ok(!adminSessions.some((session) => session.sessionId === adminSessionId),
    'administrator session idle for one hour must not be listed as active');

  assert.equal(MEMBER_SESSION_IDLE_SECONDS, 7 * 24 * 60 * 60);
  assert.equal(SESSION_IDLE_SECONDS, 30 * 60);
});


test('live account session-version changes invalidate previously issued lower-assurance sessions', async () => {
  await resetIdoc();
  const user = await createUser();

  assert.equal(await sessionVersionIsCurrent(user.id, 0), true);

  await sql`
    update idoc.users
    set session_version = session_version + 1
    where id = ${user.id}
  `;

  assert.equal(await sessionVersionIsCurrent(user.id, 0), false,
    'a session issued before a role/security version rotation must immediately lose authority');
  assert.equal(await sessionVersionIsCurrent(user.id, 1), true);
});

test('pre-policy 12-hour ordinary-member rows keep the strict 30-minute active-session cutoff', async () => {
  await resetIdoc();
  const member = await createUser();
  const now = new Date();
  const legacySessionId = randomUUID();
  const authenticatedAt = new Date(now.getTime() - 60 * 60 * 1000);

  await registerSession({
    sessionId: legacySessionId,
    userId: member.id,
    sessionVersion: 0,
    authenticatedAt,
    lastActivityAt: authenticatedAt,
    absoluteExpiresAt: new Date(authenticatedAt.getTime() + SESSION_ABSOLUTE_SECONDS * 1000),
  });

  const active = await listActiveSessions(member.id, 0);
  assert.ok(!active.some((session) => session.sessionId === legacySessionId),
    'a pre-policy 12-hour row idle for one hour must not be shown as active under the new member policy');
});

test.after(async () => {
  await closeHarness();
});
