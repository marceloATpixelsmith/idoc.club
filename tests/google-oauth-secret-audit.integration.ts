import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import {
  latestGoogleOauthSecretRotation,
  recordActiveGoogleOauthSecretRotation,
  recordGoogleOauthSecretRotation,
} from '../lib/auth/google-oidc-secret-audit.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

// AUTH-SECRET-004: real-Postgres evidence for the "audit" half of "OAuth client secrets MUST
// support verified bounded-overlap replacement, rollback, retirement and audit without client
// exposure." Drives the actual production recordGoogleOauthSecretRotation/
// latestGoogleOauthSecretRotation functions against the real idoc.audit_log table.

beforeEach(resetIdoc);
after(closeHarness);

test('recordGoogleOauthSecretRotation persists a secret-free, non-repudiable rotation record', async () => {
  const operator = await createUser();
  await recordGoogleOauthSecretRotation({ actorId: operator.id, fromVersion: 'v1', reason: 'scheduled_rotation', toVersion: 'v2' });

  const [row] = await sql`select actor_id,action,entity_type,entity_id,before_json,after_json,reason
    from idoc.audit_log where action='auth.oauth.google.client_secret.rotated'`;
  assert.equal(row.actor_id, operator.id);
  assert.equal(row.entity_type, 'system');
  assert.equal(row.entity_id, 'google-oauth-client-secret');
  assert.deepEqual(row.before_json, { version: 'v1' });
  assert.deepEqual(row.after_json, { version: 'v2' });
  assert.equal(row.reason, 'scheduled_rotation');

  // Only non-secret version labels are ever written -- the whole row, stringified, never contains
  // anything that looks like an actual secret value (this test's own labels are the only strings
  // present besides fixed literals).
  const serialized = JSON.stringify(row);
  assert.doesNotMatch(serialized, /[A-Za-z0-9_-]{32,}/, 'no long opaque token-shaped value belongs in this audit row');
});

test('a rotation with no prior version (first-ever configuration) records a null before_json rather than a placeholder', async () => {
  await recordGoogleOauthSecretRotation({ fromVersion: null, reason: 'scheduled_rotation', toVersion: 'v1' });
  const [row] = await sql`select before_json,after_json from idoc.audit_log where action='auth.oauth.google.client_secret.rotated'`;
  assert.equal(row.before_json, null);
  assert.deepEqual(row.after_json, { version: 'v1' });
});

test('latestGoogleOauthSecretRotation returns the most recent rotation, not the first', async () => {
  assert.equal(await latestGoogleOauthSecretRotation(), null);

  await recordGoogleOauthSecretRotation({ fromVersion: null, reason: 'scheduled_rotation', toVersion: 'v1' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await recordGoogleOauthSecretRotation({ fromVersion: 'v1', reason: 'scheduled_rotation', toVersion: 'v2' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await recordGoogleOauthSecretRotation({ fromVersion: 'v2', reason: 'rollback', toVersion: 'v1' });

  const latest = await latestGoogleOauthSecretRotation();
  assert.equal(latest?.fromVersion, 'v2');
  assert.equal(latest?.toVersion, 'v1');
  assert.equal(latest?.reason, 'rollback');
  assert.ok(latest && latest.createdAtMs > 0);
});

test('the production operation records the server-configured active version without persisting its secret', async () => {
  const operator = await createUser();
  const secret = 'opaque-google-client-secret-value-never-persisted';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS = JSON.stringify({ '2026-09-03': secret });
  process.env.GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION = '2026-09-03';
  try {
    const result = await recordActiveGoogleOauthSecretRotation(operator.id);
    assert.equal(result.status, 'recorded');
    assert.equal(result.activeVersion, '2026-09-03');
    const [row] = await sql`select actor_id,before_json,after_json,reason from idoc.audit_log
      where action='auth.oauth.google.client_secret.rotated'`;
    assert.equal(row.actor_id, operator.id);
    assert.equal(row.before_json, null);
    assert.deepEqual(row.after_json, { version: '2026-09-03' });
    assert.equal(row.reason, 'scheduled_rotation');
    assert.doesNotMatch(JSON.stringify(row), new RegExp(secret));
  } finally {
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION;
  }
});

test('the production operation rejects the legacy implicit v1 form without writing evidence', async () => {
  const operator = await createUser();
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'legacy-secret-with-no-explicit-version-ring';
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION;
  try {
    await assert.rejects(() => recordActiveGoogleOauthSecretRotation(operator.id));
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from idoc.audit_log
      where action='auth.oauth.google.client_secret.rotated'`;
    assert.equal(count, 0);
  } finally {
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  }
});

test('concurrent and repeated production-operation calls create exactly one row per active version', async () => {
  const firstOperator = await createUser();
  const secondOperator = await createUser();
  process.env.GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS = JSON.stringify({ current: 'not-persisted-current-secret' });
  process.env.GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION = 'current';
  try {
    const results = await Promise.all([
      recordActiveGoogleOauthSecretRotation(firstOperator.id),
      recordActiveGoogleOauthSecretRotation(secondOperator.id),
    ]);
    assert.deepEqual(results.map(({ status }) => status).sort(), ['already-recorded', 'recorded']);
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from idoc.audit_log
      where action='auth.oauth.google.client_secret.rotated'`;
    assert.equal(count, 1);
    assert.equal((await recordActiveGoogleOauthSecretRotation(firstOperator.id)).status, 'already-recorded');
    const [{ count: afterRetry }] = await sql<{ count: number }[]>`select count(*)::int as count from idoc.audit_log
      where action='auth.oauth.google.client_secret.rotated'`;
    assert.equal(afterRetry, 1);
  } finally {
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION;
  }
});
