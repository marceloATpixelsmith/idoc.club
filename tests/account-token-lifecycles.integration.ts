import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { comparePasswords, hashPassword } from '../lib/auth/session.ts';
import { consumeAccountToken, requestAccountLink } from '../lib/membership/account-recovery.ts';
import { consumeEmailVerification } from '../lib/membership/email-verification.ts';
import { decryptDeliveryPayload } from '../lib/security/encrypted-payload.ts';
import {
  closeHarness, concurrently, createCompleteGraph, createUser, judgeRole, persistedGraph,
  profileInput, resetIdoc, sql, stewardRole, veterinarianRole,
} from './postgres-harness.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const PASSWORD = 'Replacement9Password';

beforeEach(async () => {
  process.env.ACCOUNT_DELIVERY_KEY_VERSION = 'test-v1';
  process.env.ACCOUNT_DELIVERY_ENCRYPTION_KEYS = JSON.stringify({ 'test-v1': 'integration-only-key-material-at-least-32-characters' });
  process.env.RATE_LIMIT_HASH_KEY = 'integration-only-rate-limit-secret';
  await resetIdoc();
});
after(closeHarness);

async function insertToken(userId: number, purpose: 'migration_activation' | 'password_reset', rawToken: string, expiresAt = new Date(Date.now() + 60_000)) {
  const [token] = await sql<{ id: number }[]>`insert into idoc.account_tokens(user_id,purpose,token_hash,expires_at)
    values(${userId},${purpose},${digest(rawToken)},${expiresAt.toISOString()}) returning id`;
  return token;
}

async function rawRequestedToken(userId: number, purpose: 'migration_activation' | 'password_reset') {
  const [row] = await sql<{ encrypted_payload: string; key_version: string }[]>`
    select encrypted_payload,key_version from idoc.account_delivery_outbox
    where user_id=${userId} and purpose=${purpose} order by id desc limit 1`;
  assert.ok(row);
  return decryptDeliveryPayload(row.encrypted_payload, row.key_version).token;
}

test('registration verification atomically changes the existing identity and preserves its complete PostgreSQL graph', async () => {
  const graph = await createCompleteGraph();
  await sql`insert into idoc.professional_roles(profile_id,role_type,effective_to)
    values(${graph.profile.id},'steward',now())`;
  await sql`insert into idoc.profile_change_history(profile_id,actor_id,before_json,after_json)
    values(${graph.profile.id},${graph.user.id},'{}','{}')`;
  const raw = 'registration-verification-token-12345678901234567890';
  const changedEmail = 'changed@example.test';
  await sql`insert into idoc.email_verification_tokens(user_id,token_hash,pending_email,expires_at)
    values(${graph.user.id},${digest(raw)},${changedEmail},now()+interval '1 hour')`;
  const before = await persistedGraph(graph.user.id);

  const results = await concurrently(
    () => consumeEmailVerification(raw),
    () => consumeEmailVerification(raw),
  );
  const values = results.map((result) => result.status === 'fulfilled' ? result.value.status : 'rejected').sort();
  assert.deepEqual(values, ['invalid', 'verified']);
  const after = await persistedGraph(graph.user.id);
  assert.equal(after.user.id, before.user.id);
  assert.equal(after.user.email, changedEmail);
  assert.equal(after.profile.id, before.profile.id);
  assert.deepEqual(after.roles, before.roles);
  assert.deepEqual(after.membership, before.membership);
  assert.deepEqual(after.billing, before.billing);
  assert.deepEqual(after.migration, before.migration);
  assert.deepEqual(after.profileHistory, before.profileHistory);
  assert.equal((await sql`select count(*)::int as count from idoc.users`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.profiles`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.teams`)[0].count, 0);
  assert.equal((await sql`select consumed_at is not null as consumed from idoc.email_verification_tokens`)[0].consumed, true);
  assert.equal(JSON.stringify(await sql`select * from idoc.email_verification_tokens`).includes(raw), false);
});

test('conflicting normalized registration verification email fails atomically without consuming or mutating', async () => {
  const graph = await createCompleteGraph();
  await createUser();
  await sql`update idoc.users set email='occupied@example.test' where id<>${graph.user.id}`;
  const raw = 'conflicting-registration-token-123456789012345678901';
  await sql`insert into idoc.email_verification_tokens(user_id,token_hash,pending_email,expires_at)
    values(${graph.user.id},${digest(raw)},'OCCUPIED@example.test',now()+interval '1 hour')`;
  const before = await persistedGraph(graph.user.id);
  await assert.rejects(consumeEmailVerification(raw));
  assert.deepEqual(await persistedGraph(graph.user.id), before);
  assert.equal((await sql`select consumed_at from idoc.email_verification_tokens where token_hash=${digest(raw)}`)[0].consumed_at, null);
});

test('password recovery is neutral, purpose-separated, rate-limited, digest-only, and uses injected timing', async () => {
  const existing = await createUser('active');
  let now = 1_000;
  const sleeps: number[] = [];
  const timing = { now: () => now, random: () => 0, sleep: async (milliseconds: number) => { sleeps.push(milliseconds); now += milliseconds; } };
  await requestAccountLink(`  ${existing.email.toUpperCase()} `, 'password_reset', 'protected-origin', timing);
  await requestAccountLink('absent@example.test', 'password_reset', 'protected-origin', timing);
  assert.equal(sleeps.length, 2);
  assert.equal(sleeps.every((value) => value === 350), true);
  assert.equal((await sql`select count(*)::int as count from idoc.account_tokens`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.account_delivery_outbox`)[0].count, 1);
  const raw = await rawRequestedToken(existing.id, 'password_reset');
  const evidence = JSON.stringify(await sql`select * from idoc.account_request_limits`);
  assert.equal(evidence.includes(existing.email), false);
  assert.equal(evidence.includes('protected-origin'), false);
  assert.equal(JSON.stringify(await sql`select * from idoc.account_tokens`).includes(raw), false);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt === 0) await sql`update idoc.users set account_state='migrated_pending' where id=${existing.id}`;
    await requestAccountLink(existing.email, 'migration_activation', 'protected-origin', timing);
  }
  const limits = await sql`select purpose,request_count from idoc.account_request_limits order by purpose`;
  assert.deepEqual(limits.map(({ purpose }) => purpose), ['migration_activation', 'password_reset', 'password_reset']);
  assert.equal(limits.find(({ purpose }) => purpose === 'migration_activation')?.request_count, 5);
  assert.equal((await sql`select count(*)::int as count from idoc.account_tokens`)[0].count, 4);
  assert.equal((await sql`select count(*)::int as count from idoc.account_tokens where purpose='migration_activation'`)[0].count, 3);
  assert.equal((await sql`select count(*)::int as count from idoc.account_delivery_outbox`)[0].count, 4);
});

test('password reset has one concurrent winner, rotates credentials, invalidates sessions, and rejects replay and cross-purpose tokens', async () => {
  const user = await createUser('active');
  const oldPassword = 'Original8Password';
  await sql`update idoc.users set password_hash=${await hashPassword(oldPassword)},session_version=7 where id=${user.id}`;
  await requestAccountLink(user.email, 'password_reset', 'origin', { now: () => 0, random: () => 0, sleep: async () => undefined });
  const raw = await rawRequestedToken(user.id, 'password_reset');
  const outcomes = await concurrently(
    () => consumeAccountToken(raw, 'password_reset', PASSWORD),
    () => consumeAccountToken(raw, 'password_reset', PASSWORD),
  );
  assert.deepEqual(outcomes.map((result) => result.status === 'fulfilled' ? result.value.status : 'rejected').sort(), ['invalid', 'success']);
  const [changed] = await sql`select password_hash,session_version from idoc.users where id=${user.id}`;
  assert.equal(await comparePasswords(oldPassword, changed.password_hash), false);
  assert.equal(await comparePasswords(PASSWORD, changed.password_hash), true);
  assert.equal(changed.session_version, 8);
  assert.equal((await consumeAccountToken(raw, 'password_reset', PASSWORD)).status, 'invalid');
  const activationRaw = 'migration-purpose-token-12345678901234567890123';
  await insertToken(user.id, 'migration_activation', activationRaw);
  assert.equal((await consumeAccountToken(activationRaw, 'password_reset', PASSWORD)).status, 'invalid');
  const evidence = JSON.stringify(await sql`select * from idoc.audit_log`);
  assert.equal(evidence.includes(PASSWORD), false);
  assert.equal(evidence.includes(raw), false);
});

test('migrated activation preserves every imported classification and complete Release 1 graph without duplicates', async () => {
  const classifications = [[judgeRole], [stewardRole], [judgeRole, stewardRole], [veterinarianRole]];
  for (const roles of classifications) {
    await resetIdoc();
    const graph = await createCompleteGraph();
    await sql`update idoc.users set account_state='migrated_pending',email_verified_at=null,session_version=4 where id=${graph.user.id}`;
    await sql`delete from idoc.professional_roles where profile_id=${graph.profile.id}`;
    for (const role of roles) {
      await sql`insert into idoc.professional_roles(profile_id,role_type,national_federation_country_code,idoc_region,fei_id,official_status,is_technical_delegate)
        values(${graph.profile.id},${role.roleType},${'nationalFederationCountryCode' in role ? role.nationalFederationCountryCode : null},${'idocRegion' in role ? role.idocRegion : null},${'feiId' in role ? role.feiId : null},${'officialStatus' in role ? role.officialStatus : null},${'isTechnicalDelegate' in role ? role.isTechnicalDelegate : null})`;
    }
    await sql`insert into idoc.professional_roles(profile_id,role_type,effective_to) values(${graph.profile.id},'judge',now())`;
    const before = await persistedGraph(graph.user.id);
    const raw = `activation-token-${String(graph.user.id).padStart(28, '0')}`.padEnd(43, 'x').slice(0, 43);
    await insertToken(graph.user.id, 'migration_activation', raw);
    assert.equal((await consumeAccountToken(raw, 'migration_activation', PASSWORD)).status, 'success');
    const after = await persistedGraph(graph.user.id);
    assert.equal(after.user.id, before.user.id);
    assert.equal(after.user.account_state, 'active');
    assert.equal(after.user.session_version, 5);
    assert.equal(await comparePasswords(PASSWORD, after.user.password_hash), true);
    assert.deepEqual(after.profile, before.profile);
    assert.deepEqual(after.roles, before.roles);
    assert.deepEqual(after.membership, before.membership);
    assert.deepEqual(after.billing, before.billing);
    assert.deepEqual(after.migration, before.migration);
    for (const table of ['users', 'profiles', 'memberships', 'billing_accounts', 'migration_map']) {
      assert.equal((await sql.unsafe(`select count(*)::int as count from idoc.${table}`))[0].count, 1, table);
    }
  }
});

test('migrated activation accepts an expired imported member without Stripe linkage or Address 2', async () => {
  const graph = await createCompleteGraph();
  await sql`update idoc.users set account_state='migrated_pending',email_verified_at=null where id=${graph.user.id}`;
  await sql`update idoc.profiles set address_2=null where id=${graph.profile.id}`;
  await sql`update idoc.memberships set status='expired',valid_until='2025-12-31' where profile_id=${graph.profile.id}`;
  await sql`delete from idoc.billing_accounts where profile_id=${graph.profile.id}`;
  const raw = 'expired-import-activation-token-1234567890x';
  await insertToken(graph.user.id, 'migration_activation', raw);

  assert.equal((await consumeAccountToken(raw, 'migration_activation', PASSWORD)).status, 'success');
  const [activated] = await sql`select account_state,email_verified_at from idoc.users where id=${graph.user.id}`;
  assert.equal(activated.account_state, 'active');
  assert.ok(activated.email_verified_at);
  assert.equal((await sql`select count(*)::int as count from idoc.billing_accounts where profile_id=${graph.profile.id}`)[0].count, 0);
});

test('migrated activation failure matrix preserves foundations, credentials, session, and token while retaining safe reconciliation evidence', async () => {
  const cases = [
    { name: 'missing mapping', mutate: (graph: Awaited<ReturnType<typeof createCompleteGraph>>) => sql`delete from idoc.migration_map where new_entity_id=${String(graph.user.id)}` },
    { name: 'missing profile', mutate: (graph: Awaited<ReturnType<typeof createCompleteGraph>>) => sql`delete from idoc.billing_accounts where profile_id=${graph.profile.id}`.then(() => sql`delete from idoc.professional_roles where profile_id=${graph.profile.id}`).then(() => sql`delete from idoc.memberships where profile_id=${graph.profile.id}`).then(() => sql`delete from idoc.profiles where id=${graph.profile.id}`) },
    { name: 'malformed profile', mutate: (graph: Awaited<ReturnType<typeof createCompleteGraph>>) => sql`update idoc.profiles set country_code='XX' where id=${graph.profile.id}` },
    { name: 'missing role', mutate: (graph: Awaited<ReturnType<typeof createCompleteGraph>>) => sql`delete from idoc.professional_roles where profile_id=${graph.profile.id}` },
    { name: 'invalid membership', mutate: (graph: Awaited<ReturnType<typeof createCompleteGraph>>) => sql`update idoc.memberships set status='review_required' where profile_id=${graph.profile.id}` },
  ];
  for (const scenario of cases) {
    await resetIdoc();
    const graph = await createCompleteGraph();
    await sql`update idoc.users set account_state='migrated_pending',email_verified_at=null,password_hash='unchanged',session_version=9 where id=${graph.user.id}`;
    await scenario.mutate(graph);
    const raw = `failure-token-${scenario.name.replaceAll(' ', '-')}`.padEnd(43, 'x').slice(0, 43);
    await insertToken(graph.user.id, 'migration_activation', raw);
    const before = await sql`select * from idoc.users where id=${graph.user.id}`;
    assert.equal((await consumeAccountToken(raw, 'migration_activation', PASSWORD)).status, 'invalid', scenario.name);
    assert.deepEqual(await sql`select * from idoc.users where id=${graph.user.id}`, before, scenario.name);
    assert.equal((await sql`select consumed_at from idoc.account_tokens where token_hash=${digest(raw)}`)[0].consumed_at, null);
    const evidence = JSON.stringify(await sql`select action,reason from idoc.audit_log`);
    assert.equal(evidence.includes(graph.user.email), false);
    assert.equal(evidence.includes(raw), false);
    assert.equal(evidence.includes(PASSWORD), false);
    assert.equal(evidence.includes('incomplete_import_foundation') || evidence.includes('missing_imported_profile'), true);
  }
});
