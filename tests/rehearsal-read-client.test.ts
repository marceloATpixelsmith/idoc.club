import assert from 'node:assert/strict';
import test from 'node:test';
import { rehearsalReadStatus, restrictToReads, RehearsalReadOnlyError } from '../lib/payments/rehearsal-read-client.ts';

const restricted = `rk_live_${'a'.repeat(24)}`;
const base = {
  DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'true',
  LEGACY_STRIPE_SECRET_KEY: restricted,
  STRIPE_SECRET_KEY: `sk_test_${'b'.repeat(24)}`,
  VERCEL_ENV: 'preview',
};

test('rehearsal reads are active only on the staging schema, under the hold, with a separate restricted live key', () => {
  assert.deepEqual(rehearsalReadStatus(base, 'idoc_staging'), { active: true, key: restricted });
});

for (const [name, environment, schema, reason] of [
  ['no key configured', { ...base, LEGACY_STRIPE_SECRET_KEY: undefined }, 'idoc_staging', 'not_configured'],
  ['production schema', base, 'idoc_production', 'not_staging_schema'],
  ['legacy schema', base, 'idoc', 'not_staging_schema'],
  ['hold released', { ...base, DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'false' }, 'idoc_staging', 'communications_hold_off'],
  ['hold unset (fails closed to on, so still allowed only with the key)', { ...base, DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: undefined }, 'idoc_staging', null],
  ['a live deployment', { ...base, VERCEL_ENV: 'production', BASE_URL: 'https://idoc.club' }, 'idoc_staging', 'live_deployment'],
  ['an unrestricted live key', { ...base, LEGACY_STRIPE_SECRET_KEY: `sk_live_${'a'.repeat(24)}` }, 'idoc_staging', 'not_restricted_live_key'],
  ['a test key', { ...base, LEGACY_STRIPE_SECRET_KEY: `rk_test_${'a'.repeat(24)}` }, 'idoc_staging', 'not_restricted_live_key'],
  ['the application key reused', { ...base, STRIPE_SECRET_KEY: restricted }, 'idoc_staging', 'same_as_application_key'],
] as const) {
  test(`rehearsal reads stay off: ${name}`, () => {
    const status = rehearsalReadStatus(environment, schema);
    if (reason === null) assert.equal(status.active, true);
    else assert.deepEqual(status, { active: false, reason });
  });
}

test('the read-only facade allows list, retrieve and search on billing resources and nothing else', async () => {
  const calls: string[] = [];
  const resource = { list: async () => { calls.push('list'); return 'ok'; }, retrieve: async () => 'ok', search: async () => 'ok', create: async () => { calls.push('create'); }, update: async () => { calls.push('update'); }, del: async () => { calls.push('del'); }, cancel: async () => { calls.push('cancel'); } };
  const client = restrictToReads({ customers: resource, subscriptions: resource, invoices: resource, refunds: resource, billingPortal: resource, webhooks: resource });
  assert.equal(await client.customers.list(), 'ok');
  assert.equal(await client.subscriptions.retrieve(), 'ok');
  for (const mutation of ['create', 'update', 'del', 'cancel'] as const) {
    assert.throws(() => (client.customers as Record<string, unknown>)[mutation], RehearsalReadOnlyError);
  }
  for (const other of ['refunds', 'billingPortal', 'webhooks'] as const) {
    assert.throws(() => client[other], RehearsalReadOnlyError);
  }
  assert.deepEqual(calls, ['list']);
});

test('the facade can be returned from an async function without being treated as a promise', async () => {
  const client = restrictToReads({ customers: { list: async () => 'ok' } });
  const returned = await (async () => client)();
  assert.equal(await returned.customers.list(), 'ok');
});
