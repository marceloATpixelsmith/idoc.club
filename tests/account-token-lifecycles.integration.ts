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
import { stubPasswordBreachCheckAsClean } from './password-breach-check-stub.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const PASSWORD = 'Replacement9Password';
const restoreFetch = stubPasswordBreachCheckAsClean();

beforeEach(async () => {
  process.env.ACCOUNT_DELIVERY_KEY_VERSION = 'test-v1';
  process.env.ACCOUNT_DELIVERY_ENCRYPTION_KEYS = JSON.stringify({ 'test-v1': 'integration-only-key-material-at-least-32-characters' });
  process.env.RATE_LIMIT_HASH_KEY = 'integration-only-rate-limit-secret';
  await resetIdoc();
});
after(closeHarness);
after(restoreFetch);

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
  // The conflicting existing row is 'occupied@example.test' (lowercase) and this token's
  // pending_email is 'OCCUPIED@example.test' (uppercase, inserted directly to bypass normalizeEmail)
  // -- an exact-match existence check misses that collision, so it is caught instead by the
  // case-insensitive users_normalized_email_unique constraint, and consumeEmailVerification resolves
  // to the same graceful 'invalid' outcome as any other conflicting claim, not an uncaught rejection.
  assert.deepEqual(await consumeEmailVerification(raw), { status: 'invalid' });
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
  // Each requestAccountLink call now takes the same dual-independent-bucket path proven generically
  // in tests/rate-limit-normalization.integration.ts (AUTH-RATE-002 closed): one email-keyed row and
  // one origin-keyed row per purpose, rather than the single combined-key row the legacy bucket used
  // to produce. Here every migration_activation call reuses the same email+origin, so both of its
  // rows land on the same key each time and simply accumulate to 5; the password_reset calls use two
  // distinct emails against the same origin, so they produce two distinct email-keyed rows plus one
  // shared origin-keyed row.
  const limits = await sql`select purpose,request_count from idoc.account_request_limits order by purpose`;
  assert.deepEqual(limits.map(({ purpose }) => purpose),
    ['migration_activation', 'migration_activation', 'password_reset', 'password_reset', 'password_reset']);
  const migrationLimits = limits.filter(({ purpose }) => purpose === 'migration_activation');
  assert.equal(migrationLimits.length, 2);
  assert.ok(migrationLimits.every(({ request_count }) => request_count === 5));
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
      await sql`insert into idoc.professional_roles(profile_id,role_type,national_federation_country_code,idoc_region,fei_id,official_statuses,is_technical_delegate)
        values(${graph.profile.id},${role.roleType},${'nationalFederationCountryCode' in role ? role.nationalFederationCountryCode : null},${'idocRegion' in role ? role.idocRegion : null},${'feiId' in role ? role.feiId : null},${'officialStatuses' in role ? sql.array([...role.officialStatuses]) : null},${'isTechnicalDelegate' in role ? role.isTechnicalDelegate : null})`;
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

test('rotating the origin alone cannot bypass the legacy recovery path\'s per-email allowance (AUTH-RATE-002 closed)', async () => {
  const user = await createUser('active');
  const timing = { now: () => 0, random: () => 0, sleep: async () => undefined };
  // Under the previous single combined-key bucket, a fresh origin on every call would each get its
  // own independent allowance for the same email -- exactly the gap this migration to the shared
  // dual-bucket primitive (lib/security/rate-limit.ts, already proven generically in
  // tests/rate-limit-normalization.integration.ts) closes.
  await requestAccountLink(user.email, 'password_reset', 'origin-1', timing);
  await requestAccountLink(user.email, 'password_reset', 'origin-2', timing);
  await requestAccountLink(user.email, 'password_reset', 'origin-3', timing);
  assert.equal((await sql`select count(*)::int as count from idoc.account_tokens where user_id=${user.id} and purpose='password_reset'`)[0].count, 3);
  await requestAccountLink(user.email, 'password_reset', 'never-seen-before-origin', timing);
  assert.equal((await sql`select count(*)::int as count from idoc.account_tokens where user_id=${user.id} and purpose='password_reset'`)[0].count, 3,
    'a brand-new origin must not grant a fresh allowance for an email that has already exhausted its own bucket');
});

test('a breached password is rejected without consuming the token, and alerts the configured operations recipient', async () => {
  process.env.IDOC_ADMIN_NOTIFICATION_EMAIL = 'webmaster@idoc.club';
  process.env.BREVO_API_KEY = 'integration-only-brevo-key';
  process.env.BREVO_FROM_EMAIL = 'accounts@idoc.club';
  const breachedPassword = 'Breached9Password';
  const suffix = createHash('sha1').update(breachedPassword, 'utf8').digest('hex').toUpperCase().slice(5);
  const originalFetch = globalThis.fetch;
  const sentMessages: unknown[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('https://api.pwnedpasswords.com/')) {
      return new Response(`${suffix}:37`, { headers: { 'content-type': 'text/plain' }, status: 200 });
    }
    if (url === 'https://api.brevo.com/v3/smtp/email') {
      sentMessages.push(JSON.parse(String(init?.body)));
      return new Response('{"messageId":"<test@smtp-relay.brevo.com>"}', { headers: { 'content-type': 'application/json' }, status: 201 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const user = await createUser('active');
    const [before] = await sql`select password_hash from idoc.users where id=${user.id}`;
    await requestAccountLink(user.email, 'password_reset', 'origin', { now: () => 0, random: () => 0, sleep: async () => undefined });
    const raw = await rawRequestedToken(user.id, 'password_reset');
    const result = await consumeAccountToken(raw, 'password_reset', breachedPassword);
    assert.deepEqual(result, { status: 'breached_password' });
    assert.equal((await sql`select consumed_at from idoc.account_tokens where token_hash=${digest(raw)}`)[0].consumed_at, null);
    const [after] = await sql`select password_hash from idoc.users where id=${user.id}`;
    assert.equal(after.password_hash, before.password_hash);
    assert.equal(sentMessages.length, 1);
    const [message] = sentMessages as [{ htmlContent: string; to: { email: string }[] }];
    assert.equal(message.to[0].email, 'webmaster@idoc.club');
    assert.equal(message.htmlContent.includes(breachedPassword), false);
    assert.equal(message.htmlContent.includes(user.email), true);
    // The same good password, using the same still-unconsumed token, still succeeds afterward --
    // rejecting a breached password must not burn the user's one-time recovery token.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://api.pwnedpasswords.com/')) return new Response('', { status: 200 });
      return originalFetch(input, init);
    }) as typeof fetch;
    assert.equal((await consumeAccountToken(raw, 'password_reset', PASSWORD)).status, 'success');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_FROM_EMAIL;
  }
});

test('a breached password alert is skipped, not thrown, when no operations recipient is configured', async () => {
  delete process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
  const breachedPassword = 'AnotherBreached9Password';
  const suffix = createHash('sha1').update(breachedPassword, 'utf8').digest('hex').toUpperCase().slice(5);
  const originalFetch = globalThis.fetch;
  let brevoCalled = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('https://api.pwnedpasswords.com/')) return new Response(`${suffix}:1`, { status: 200 });
    if (url === 'https://api.brevo.com/v3/smtp/email') { brevoCalled = true; return new Response('{"messageId":"<test@smtp-relay.brevo.com>"}', { status: 201 }); }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const user = await createUser('active');
    await requestAccountLink(user.email, 'password_reset', 'origin', { now: () => 0, random: () => 0, sleep: async () => undefined });
    const raw = await rawRequestedToken(user.id, 'password_reset');
    assert.deepEqual(await consumeAccountToken(raw, 'password_reset', breachedPassword), { status: 'breached_password' });
    assert.equal(brevoCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
