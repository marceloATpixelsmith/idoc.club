import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('ordinary trusted-device persistence enforces scope, expiry, revocation, and digest uniqueness without sliding', async () => {
  const first = await createUser();
  const second = await createUser();
  const issuedAt = new Date('2026-08-26T00:00:00Z');
  const expiresAt = new Date(issuedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  const digest = 'a'.repeat(64);
  await sql`insert into idoc.login_trusted_devices
    (trusted_device_id,user_id,application_id,token_digest,session_version_at_issue,issued_at,expires_at)
    values ('00000000-0000-4000-8000-000000000001',${first.id},'idoc.club',${digest},0,${issuedAt},${expiresAt})`;

  const valid = await sql`select trusted_device_id,expires_at from idoc.login_trusted_devices
    where token_digest=${digest} and user_id=${first.id} and application_id='idoc.club'
      and session_version_at_issue=0 and revoked_at is null and expires_at>${new Date('2026-08-27T00:00:00Z')}`;
  assert.equal(valid.length, 1);
  assert.equal(new Date(valid[0].expires_at).getTime(), expiresAt.getTime());
  assert.equal((await sql`select 1 from idoc.login_trusted_devices where token_digest=${digest} and user_id=${second.id}`).length, 0);
  assert.equal((await sql`select 1 from idoc.login_trusted_devices where token_digest=${digest} and application_id='another.app'`).length, 0);
  assert.equal((await sql`select 1 from idoc.login_trusted_devices where token_digest=${digest} and expires_at>${new Date('2026-09-10T00:00:01Z')}`).length, 0);

  await assert.rejects(sql`insert into idoc.login_trusted_devices
    (trusted_device_id,user_id,application_id,token_digest,session_version_at_issue,issued_at,expires_at)
    values ('00000000-0000-4000-8000-000000000002',${second.id},'idoc.club',${digest},0,${issuedAt},${expiresAt})`);
  await sql`update idoc.login_trusted_devices set revoked_at=${new Date()},revoke_reason='security_change'
    where token_digest=${digest}`;
  assert.equal((await sql`select 1 from idoc.login_trusted_devices where token_digest=${digest} and revoked_at is null`).length, 0);
});
