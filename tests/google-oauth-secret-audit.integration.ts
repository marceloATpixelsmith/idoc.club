import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { latestGoogleOauthSecretRotation, recordGoogleOauthSecretRotation } from '../lib/auth/google-oidc-secret-audit.ts';
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
