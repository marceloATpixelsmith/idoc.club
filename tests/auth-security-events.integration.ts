import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { enqueueAuthSecurityNotification } from '../lib/notifications/auth-security-events.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('security notification intents are durable, recipient-owned, secret-free, and deduplicated', async () => {
  const user = await createUser();
  const input = { dedupeKey: `password-change:${user.id}:1`, kind: 'password_changed' as const, userId: user.id };
  assert.equal(await enqueueAuthSecurityNotification(input), true);
  assert.equal(await enqueueAuthSecurityNotification(input), false);

  const rows = await sql`select user_id,kind,recipient_email,dedupe_key,created_at,sent_at from idoc.auth_security_notification_outbox`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, user.id);
  assert.equal(rows[0].recipient_email, user.email);
  assert.equal(rows[0].kind, 'password_changed');
  assert.ok(rows[0].created_at);
  assert.equal(rows[0].sent_at, null);
  const serialized = JSON.stringify(rows[0]).toLowerCase();
  for (const forbidden of ['passwordhash', 'otp', 'totp', 'recoverycode', 'digest', 'jwt', 'sessionid']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('email-change evidence can safely notify the old and new owner addresses', async () => {
  const user = await createUser();
  await enqueueAuthSecurityNotification({ dedupeKey: `email:${user.id}:old`, kind: 'verified_email_changed', recipientEmail: user.email, userId: user.id });
  await enqueueAuthSecurityNotification({ dedupeKey: `email:${user.id}:new`, kind: 'verified_email_changed', recipientEmail: 'new@example.test', userId: user.id });
  const rows = await sql`select recipient_email from idoc.auth_security_notification_outbox order by recipient_email`;
  assert.deepEqual(rows.map(({ recipient_email }) => recipient_email), [user.email, 'new@example.test'].sort());
});
