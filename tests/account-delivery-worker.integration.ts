import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { GET } from '../app/api/cron/account-delivery/route.ts';
import { requestAccountLink } from '../lib/membership/account-recovery.ts';
import {
  ACCOUNT_DELIVERY_MAX_ATTEMPTS,
  accountDeliveryRetrySeconds,
  claimAccountDelivery,
  deliverNextAccountLink,
} from '../lib/notifications/account-delivery.ts';
import { ACCOUNT_DELIVERY_BATCH_LIMIT } from '../lib/notifications/account-delivery-worker-core.ts';
import { deliverProfileChangeNotification } from '../lib/notifications/profile-change-delivery.ts';
import { closeHarness, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

const CLOCK = new Date(Date.now() + 60_000);
const RAW_SECRET = 'integration-cron-secret-at-least-32-characters';
const TOKEN_PATTERN = /token=([A-Za-z0-9_-]{43})/;
const timing = { now: () => 0, random: () => 0, sleep: async () => undefined };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

beforeEach(async () => {
  process.env.ACCOUNT_DELIVERY_KEY_VERSION = 'test-v1';
  process.env.ACCOUNT_DELIVERY_ENCRYPTION_KEYS = JSON.stringify({ 'test-v1': 'integration-only-key-material-at-least-32-characters' });
  process.env.BASE_URL = 'https://account.test';
  process.env.CRON_SECRET = RAW_SECRET;
  process.env.IDOC_ADMIN_NOTIFICATION_EMAIL = 'operations@example.test';
  process.env.MAILCHIMP_TRANSACTIONAL_API_KEY = 'provider-test-double-key-at-least-32-chars';
  process.env.RATE_LIMIT_HASH_KEY = 'integration-only-rate-limit-secret';
  await resetIdoc();
});
after(closeHarness);

async function queue(state: 'active' | 'migrated_pending' | 'onboarding' = 'active') {
  const user = await createUser(state);
  const purpose = state === 'migrated_pending' ? 'migration_activation' : 'password_reset';
  // A distinct origin per call: this suite calls queue() many times across many tests, and since
  // requestAccountLink now enforces a real per-origin allowance (AUTH-RATE-002) in addition to the
  // per-email one, reusing one literal origin across the whole file would eventually exhaust that
  // origin-keyed bucket -- an artifact of sharing a fixed string here, not something this file is
  // actually testing (the rate limiter itself is proven directly in
  // tests/rate-limit-normalization.integration.ts and tests/account-token-lifecycles.integration.ts).
  await requestAccountLink(user.email, purpose, `integration-origin-${randomUUID()}`, timing);
  const [row] = await sql`select * from idoc.account_delivery_outbox where user_id=${user.id}`;
  assert.ok(row);
  return { purpose, row, user };
}

test('account delivery succeeds once with stable identity, safe evidence, and an unconsumed eligible token', async () => {
  const { row } = await queue();
  const messages: Array<{ html: string; messageId?: string; to: string }> = [];
  const send = async (message: { html: string; messageId?: string; subject: string; to: string }) => { messages.push(message); };
  assert.equal((await deliverNextAccountLink('success-worker', { now: () => CLOCK, send })).status, 'delivered');
  assert.equal((await deliverNextAccountLink('second-worker', { now: () => CLOCK, send })).status, 'empty');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].messageId, row.message_id);
  const [stored] = await sql`select * from idoc.account_delivery_outbox where id=${row.id}`;
  assert.equal(stored.attempt_count, 1);
  assert.equal(new Date(stored.sent_at).toISOString(), CLOCK.toISOString());
  assert.equal(stored.lease_owner, null);
  assert.equal(stored.lease_expires_at, null);
  const [token] = await sql`select * from idoc.account_tokens where id=${row.token_id}`;
  assert.equal(token.consumed_at, null);
  assert.equal(token.user_id, stored.user_id);
  assert.equal(token.purpose, stored.purpose);
  assert.equal(new Date(token.expires_at) > CLOCK, true);
  const evidence = JSON.stringify(await sql`select * from idoc.audit_log`);
  const rawToken = TOKEN_PATTERN.exec(messages[0].html)?.[1];
  assert.ok(rawToken);
  assert.equal(token.token_hash, digest(rawToken));
  assert.equal(JSON.stringify(await sql`select * from idoc.account_tokens`).includes(rawToken), false);
  assert.equal(JSON.stringify(stored).includes(rawToken), false);
  assert.equal(evidence.includes(rawToken), false);
  assert.match(evidence, /delivery_succeeded/);
});

test('retry uses deterministic bounded backoff, preserves identity and token, and continues the batch', async () => {
  const first = await queue();
  const second = await queue();
  const identities: string[] = [];
  let calls = 0;
  const send = async (message: { messageId?: string }) => {
    calls += 1;
    identities.push(message.messageId ?? '');
    if (calls === 1) throw new Error('provider body containing sensitive material');
  };
  assert.equal((await deliverNextAccountLink('retry-worker', { now: () => CLOCK, send })).status, 'retryable');
  assert.equal((await deliverNextAccountLink('later-worker', { now: () => CLOCK, send })).status, 'delivered');
  const [failed] = await sql`select * from idoc.account_delivery_outbox where id=${first.row.id}`;
  assert.equal(failed.attempt_count, 1);
  assert.equal(new Date(failed.available_at).toISOString(), new Date(CLOCK.getTime() + accountDeliveryRetrySeconds(1) * 1000).toISOString());
  assert.equal(failed.last_error_code, 'temporary_delivery_failure');
  assert.equal(failed.message_id, first.row.message_id);
  assert.equal((await claimAccountDelivery('too-early', CLOCK)), null);
  assert.equal((await claimAccountDelivery('eligible-again', new Date(failed.available_at)))?.status, 'claimed');
  assert.equal((await sql`select count(*)::int count from idoc.account_delivery_outbox`)[0].count, 2);
  assert.equal((await sql`select count(*)::int count from idoc.account_tokens`)[0].count, 2);
  assert.equal((await sql`select consumed_at from idoc.account_tokens where id=${first.row.token_id}`)[0].consumed_at, null);
  assert.equal((await sql`select sent_at is not null sent from idoc.account_delivery_outbox where id=${second.row.id}`)[0].sent, true);
});

test('the sixth failed attempt dead-letters once without consuming or replacing its token and later rows continue', async () => {
  const first = await queue();
  const second = await queue();
  await sql`update idoc.account_delivery_outbox set attempt_count=${ACCOUNT_DELIVERY_MAX_ATTEMPTS - 1} where id=${first.row.id}`;
  const send = async () => { throw new Error('terminal provider failure details'); };
  assert.equal((await deliverNextAccountLink('dead-worker', { now: () => CLOCK, send })).status, 'dead_lettered');
  assert.equal((await deliverNextAccountLink('later-worker', { now: () => CLOCK, send: async () => undefined })).status, 'delivered');
  const [dead] = await sql`select * from idoc.account_delivery_outbox where id=${first.row.id}`;
  assert.equal(dead.attempt_count, ACCOUNT_DELIVERY_MAX_ATTEMPTS);
  assert.equal(new Date(dead.dead_lettered_at).toISOString(), CLOCK.toISOString());
  assert.equal(dead.last_error_code, 'temporary_delivery_failure');
  assert.equal(dead.lease_owner, null);
  assert.equal((await claimAccountDelivery('never-again', new Date('2030-01-01'))), null);
  assert.equal((await sql`select count(*)::int count from idoc.account_tokens`)[0].count, 2);
  assert.equal((await sql`select consumed_at from idoc.account_tokens where id=${first.row.token_id}`)[0].consumed_at, null);
  assert.equal((await sql`select sent_at is not null sent from idoc.account_delivery_outbox where id=${second.row.id}`)[0].sent, true);
});

test('eligibility is rechecked after claim and before provider invocation', async () => {
  const cases = [
    ['expired', async (row: { id: number; tokenId: number; userId: number }) => { await sql`update idoc.account_tokens set expires_at=${new Date(CLOCK.getTime() - 1).toISOString()} where id=${row.tokenId}`; }],
    ['consumed', async (row: { id: number; tokenId: number; userId: number }) => { await sql`update idoc.account_tokens set consumed_at=${CLOCK.toISOString()} where id=${row.tokenId}`; }],
    ['account-state', async (row: { id: number; tokenId: number; userId: number }) => { await sql`update idoc.users set account_state='suspended' where id=${row.userId}`; }],
    ['terminal-row', async (row: { id: number; tokenId: number; userId: number }) => { await sql`update idoc.account_delivery_outbox set terminal_at=${CLOCK.toISOString()},terminal_reason='superseded' where id=${row.id}`; }],
  ] as const;
  for (const [caseName, mutate] of cases) {
    await resetIdoc();
    const { row } = await queue();
    let providerCalls = 0;
    const result = await deliverNextAccountLink('recheck-worker', {
      afterClaim: mutate,
      now: () => CLOCK,
      send: async () => { providerCalls += 1; },
    });
    assert.equal(result.status, 'ineligible');
    assert.equal(providerCalls, 0);
    const [stored] = await sql`select * from idoc.account_delivery_outbox where id=${row.id}`;
    assert.equal(stored.lease_owner, null);
    assert.ok(stored.terminal_at);
    assert.match(stored.terminal_reason, /^(token_ineligible|superseded)$/);
    if (caseName !== 'consumed') {
      assert.equal((await sql`select consumed_at from idoc.account_tokens where id=${row.token_id}`)[0].consumed_at, null);
    }
  }
});

test('claim terminalizes missing, wrong-user, and wrong-purpose tokens without provider access', async () => {
  const cases = ['wrong-user', 'wrong-purpose', 'missing'] as const;
  for (const caseName of cases) {
    await resetIdoc();
    const queued = await queue();
    if (caseName === 'wrong-user') {
      const other = await createUser();
      await sql`update idoc.account_delivery_outbox set user_id=${other.id} where id=${queued.row.id}`;
    } else if (caseName === 'wrong-purpose') {
      await sql`update idoc.account_delivery_outbox set purpose='migration_activation' where id=${queued.row.id}`;
    } else {
      await sql`alter table idoc.account_delivery_outbox drop constraint account_delivery_outbox_token_id_account_tokens_id_fk`;
      await sql`update idoc.account_delivery_outbox set token_id=2147483647 where id=${queued.row.id}`;
    }
    let providerCalls = 0;
    assert.equal((await deliverNextAccountLink('invalid-worker', { now: () => CLOCK, send: async () => { providerCalls += 1; } })).status, 'ineligible');
    assert.equal(providerCalls, 0);
    const [stored] = await sql`select * from idoc.account_delivery_outbox where id=${queued.row.id}`;
    assert.equal(stored.lease_owner, null);
    assert.equal(stored.terminal_reason, caseName === 'wrong-user' ? 'user_mismatch' : caseName === 'wrong-purpose' ? 'purpose_mismatch' : 'missing_token');
    assert.ok(stored.terminal_at);
    assert.equal((await sql`select consumed_at from idoc.account_tokens where id=${queued.row.token_id}`)[0].consumed_at, null);
  }
});

test('real multi-connection workers cannot duplicate a delivery and can process distinct rows concurrently', async () => {
  await queue();
  await queue();
  const ids: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const send = async (message: { messageId?: string }) => { ids.push(message.messageId ?? ''); if (ids.length === 2) release(); await barrier; };
  const results = await Promise.all([
    deliverNextAccountLink('concurrent-a', { now: () => CLOCK, send }),
    deliverNextAccountLink('concurrent-b', { now: () => CLOCK, send }),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), ['delivered', 'delivered']);
  assert.equal(new Set(ids).size, 2);
  assert.equal((await sql`select count(*)::int count from idoc.account_delivery_outbox where sent_at is not null`)[0].count, 2);
});

test('account token and outbox creation commit atomically at every injected transaction failure stage', async () => {
  const stages = ['after_token_insert', 'after_outbox_insert', 'before_commit'] as const;
  for (const stage of stages) {
    await resetIdoc();
    const user = await createUser();
    await requestAccountLink(user.email, 'password_reset', 'atomic-origin', timing, stage);
    assert.equal((await sql`select count(*)::int count from idoc.account_tokens`)[0].count, 0);
    assert.equal((await sql`select count(*)::int count from idoc.account_delivery_outbox`)[0].count, 0);
  }
  await resetIdoc();
  await queue();
  assert.equal((await sql`select count(*)::int count from idoc.account_tokens`)[0].count, 1);
  assert.equal((await sql`select count(*)::int count from idoc.account_delivery_outbox`)[0].count, 1);
  assert.equal((await sql`select count(*)::int count from idoc.account_delivery_outbox o left join idoc.account_tokens t on t.id=o.token_id where t.id is null`)[0].count, 0);
});

test('database-boundary failures prevent send and finalization failure remains safely reconcilable', async () => {
  const queued = await queue();
  let sends = 0;
  assert.equal((await deliverNextAccountLink('pre-send-database-failure', {
    afterClaim: async () => { throw new Error('injected database boundary failure'); },
    now: () => CLOCK,
    send: async () => { sends += 1; },
  })).status, 'retryable');
  assert.equal(sends, 0);
  await sql`update idoc.account_delivery_outbox set available_at=${CLOCK.toISOString()} where id=${queued.row.id}`;
  assert.equal((await deliverNextAccountLink('finalization-failure', {
    beforeFinalize: async () => { throw new Error('injected final-state database failure'); },
    now: () => CLOCK,
    send: async ({ messageId }) => { sends += 1; assert.equal(messageId, queued.row.message_id); },
  })).status, 'retryable');
  const [stored] = await sql`select * from idoc.account_delivery_outbox where id=${queued.row.id}`;
  assert.equal(sends, 1);
  assert.equal(stored.sent_at, null);
  assert.equal(stored.attempt_count, 2);
  assert.equal(stored.last_error_code, 'temporary_delivery_failure');
  assert.equal(stored.message_id, queued.row.message_id);
  assert.equal(stored.lease_owner, null);
});

test('an earlier delivered token stays usable while a replacement retries independently', async () => {
  const first = await queue();
  let firstRaw = '';
  await deliverNextAccountLink('first', { now: () => CLOCK, send: async ({ html }) => { firstRaw = TOKEN_PATTERN.exec(html)?.[1] ?? ''; } });
  await requestAccountLink(first.user.email, 'password_reset', 'replacement-origin', timing);
  assert.equal((await deliverNextAccountLink('replacement', { now: () => CLOCK, send: async () => { throw new Error('retry'); } })).status, 'retryable');
  assert.ok(firstRaw);
  const [earlier] = await sql`select * from idoc.account_tokens where id=${first.row.token_id}`;
  assert.equal(earlier.consumed_at, null);
  assert.equal(earlier.token_hash, digest(firstRaw));
  assert.equal(JSON.stringify(await sql`select * from idoc.account_tokens`).includes(firstRaw), false);
});

test('real Cron route authenticates before PostgreSQL access and returns only bounded aggregate evidence', async () => {
  const originalFetch = globalThis.fetch;
  const providerBodies: string[] = [];
  globalThis.fetch = async (_input, init) => { providerBodies.push(String(init?.body)); return new Response('[{"status":"sent"}]', { status: 200 }); };
  try {
    const unauthorized = [
      new Request(`https://idoc.club/api/cron/account-delivery?authorization=${RAW_SECRET}`),
      new Request('https://idoc.club/api/cron/account-delivery', { headers: { authorization: RAW_SECRET } }),
      new Request('https://idoc.club/api/cron/account-delivery', { headers: { authorization: 'Bearer wrong' } }),
    ];
    for (const request of unauthorized) assert.equal((await GET(request)).status, 401);
    assert.equal((await sql`select count(*)::int count from idoc.account_delivery_outbox`)[0].count, 0);
    const empty = await GET(new Request('https://idoc.club/api/cron/account-delivery', { headers: { authorization: `Bearer ${RAW_SECRET}` } }));
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { deadLettered: 0, delivered: 0, ineligible: 0, leaseLost: 0, retryable: 0 });
    for (let index = 0; index < 22; index += 1) await queue();
    const response = await GET(new Request('https://idoc.club/api/cron/account-delivery', { headers: { authorization: `Bearer ${RAW_SECRET}` } }));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { deadLettered: 0, delivered: 20, ineligible: 0, leaseLost: 0, retryable: 0 });
    assert.equal(providerBodies.length, 20);
    assert.equal(body.includes('@'), false);
    assert.equal(body.includes(RAW_SECRET), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the Cron route shared-secret check rejects wrong case and mismatched length without ever reaching PostgreSQL', async () => {
  const cases = [
    ['lowercase bearer prefix', `bearer ${RAW_SECRET}`],
    ['shorter than the configured secret', 'Bearer too-short'],
    ['longer than the configured secret', `Bearer ${RAW_SECRET}-and-then-some-more-characters`],
  ] as const;
  for (const [caseName, presented] of cases) {
    const response = await GET(new Request('https://idoc.club/api/cron/account-delivery', { headers: { authorization: presented } }));
    assert.equal(response.status, 401, caseName);
    assert.deepEqual(await response.json(), { error: 'Unauthorized' }, caseName);
  }
  assert.equal((await sql`select count(*)::int as count from idoc.account_delivery_outbox`)[0].count, 0);
});

test('a batch bounded by the processing limit counts ineligible rows toward that limit and leaves the remainder for the next invocation', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[{"status":"sent"}]', { status: 200 });
  try {
    for (let index = 0; index < 10; index += 1) {
      const { row } = await queue();
      await sql`update idoc.account_tokens set expires_at=${new Date(Date.now() - 1000).toISOString()} where id=${row.token_id}`;
    }
    for (let index = 0; index < 15; index += 1) await queue();

    const response = await GET(new Request('https://idoc.club/api/cron/account-delivery', { headers: { authorization: `Bearer ${RAW_SECRET}` } }));
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(summary.ineligible, 10, 'the 10 already-expired-token rows must be processed (and terminalized), not skipped for free');
    assert.equal(summary.delivered, ACCOUNT_DELIVERY_BATCH_LIMIT - 10, 'only enough of the 15 eligible rows to fill the remaining budget may be delivered in this call');
    assert.equal(summary.ineligible + summary.delivered, ACCOUNT_DELIVERY_BATCH_LIMIT, 'terminal outcomes count toward the same bounded budget as successful deliveries');

    const remaining = await sql`select count(*)::int as count from idoc.account_delivery_outbox where sent_at is null and terminal_at is null and dead_lettered_at is null`;
    assert.equal(remaining[0].count, 10 + 15 - ACCOUNT_DELIVERY_BATCH_LIMIT, 'rows beyond the bounded budget must remain untouched for the next invocation');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('administrator notifications use distinct leases and stable identities concurrently', async () => {
  const firstUser = await createUser();
  const secondUser = await createUser();
  const firstProfile = await createProfile(firstUser.id);
  const secondProfile = await createProfile(secondUser.id);
  await sql`insert into idoc.notification_outbox(profile_id,kind,payload) values(${firstProfile.id},'administrator.profile_changed','{}'),(${secondProfile.id},'administrator.profile_changed','{}')`;
  const originalFetch = globalThis.fetch;
  const ids: string[] = [];
  globalThis.fetch = async (_input, init) => { ids.push(JSON.parse(String(init?.body)).message.headers['X-IDOC-Message-ID']); return new Response('[{"status":"sent"}]', { status: 200 }); };
  try {
    const results = await Promise.all([deliverProfileChangeNotification(undefined, 'admin-a'), deliverProfileChangeNotification(undefined, 'admin-b')]);
    assert.deepEqual(results.map(({ status }) => status).sort(), ['delivered', 'delivered']);
    assert.equal(new Set(ids).size, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
