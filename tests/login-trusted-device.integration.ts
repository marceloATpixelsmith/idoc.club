import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('ordinary trusted-device persistence enforces scope, expiry, revocation, digest uniqueness, current sessionVersion, and non-sliding expiry', async () => {
  const first = await createUser();
  const second = await createUser();
  const issuedAt = new Date('2026-08-26T00:00:00Z').toISOString();
  const expiresAt = new Date(new Date(issuedAt).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const digest = 'a'.repeat(64);
  await sql`insert into idoc.login_trusted_devices
    (trusted_device_id,user_id,application_id,token_digest,session_version_at_issue,issued_at,expires_at)
    values ('00000000-0000-4000-8000-000000000001',${first.id},'idoc.club',${digest},0,${issuedAt},${expiresAt})`;

  const valid = await sql`select d.trusted_device_id,d.expires_at from idoc.login_trusted_devices d
    join idoc.users u on u.id=d.user_id
    where d.token_digest=${digest} and d.user_id=${first.id} and d.application_id='idoc.club'
      and d.session_version_at_issue=0 and u.session_version=d.session_version_at_issue
      and u.deleted_at is null and u.account_state in ('active','onboarding')
      and d.revoked_at is null and d.expires_at>${new Date('2026-08-27T00:00:00Z').toISOString()}`;
  assert.equal(valid.length, 1);
  assert.equal(new Date(valid[0].expires_at).getTime(), new Date(expiresAt).getTime());
  assert.equal((await sql`select 1 from idoc.login_trusted_devices where token_digest=${digest} and user_id=${second.id}`).length, 0);
  assert.equal((await sql`select 1 from idoc.login_trusted_devices where token_digest=${digest} and application_id='another.app'`).length, 0);
  assert.equal((await sql`select 1 from idoc.login_trusted_devices where token_digest=${digest} and expires_at>${new Date('2026-09-10T00:00:01Z').toISOString()}`).length, 0);

  await assert.rejects(sql`insert into idoc.login_trusted_devices
    (trusted_device_id,user_id,application_id,token_digest,session_version_at_issue,issued_at,expires_at)
    values ('00000000-0000-4000-8000-000000000002',${second.id},'idoc.club',${digest},0,${issuedAt},${expiresAt})`);

  await sql`update idoc.users set session_version=session_version+1 where id=${first.id}`;
  const staleAfterSecurityChange = await sql`select 1 from idoc.login_trusted_devices d
    join idoc.users u on u.id=d.user_id
    where d.token_digest=${digest} and d.user_id=${first.id}
      and d.session_version_at_issue=u.session_version and d.revoked_at is null
      and d.expires_at>${new Date('2026-08-27T00:00:00Z').toISOString()}`;
  assert.equal(staleAfterSecurityChange.length, 0, 'sessionVersion changes must invalidate existing device trust');

  await sql`update idoc.login_trusted_devices set revoked_at=${new Date().toISOString()},revoke_reason='security_change'
    where token_digest=${digest}`;
  assert.equal((await sql`select 1 from idoc.login_trusted_devices where token_digest=${digest} and revoked_at is null`).length, 0);

  const [after] = await sql`select issued_at,expires_at from idoc.login_trusted_devices where token_digest=${digest}`;
  assert.equal(new Date(after.issued_at).getTime(), new Date(issuedAt).getTime());
  assert.equal(new Date(after.expires_at).getTime(), new Date(expiresAt).getTime(), 'validation/revocation must not slide expiry');
});

test('ordinary trust becomes unusable when account eligibility changes', async () => {
  const user = await createUser();
  const issuedAt = new Date('2026-08-26T00:00:00Z').toISOString();
  const expiresAt = new Date('2026-09-09T00:00:00Z').toISOString();
  const digest = 'b'.repeat(64);
  await sql`insert into idoc.login_trusted_devices
    (trusted_device_id,user_id,application_id,token_digest,session_version_at_issue,issued_at,expires_at)
    values ('00000000-0000-4000-8000-000000000003',${user.id},'idoc.club',${digest},0,${issuedAt},${expiresAt})`;

  const eligible = () => sql`select 1 from idoc.login_trusted_devices d
    join idoc.users u on u.id=d.user_id
    where d.token_digest=${digest} and d.user_id=${user.id} and d.application_id='idoc.club'
      and d.session_version_at_issue=u.session_version and u.deleted_at is null
      and u.account_state in ('active','onboarding') and d.revoked_at is null
      and d.expires_at>${new Date('2026-08-27T00:00:00Z').toISOString()}`;

  assert.equal((await eligible()).length, 1);
  await sql`update idoc.users set deleted_at=${new Date().toISOString()} where id=${user.id}`;
  assert.equal((await eligible()).length, 0, 'deleted accounts must never use remembered login trust');
});
