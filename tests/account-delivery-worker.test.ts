import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ACCOUNT_DELIVERY_BATCH_LIMIT, handleAccountDeliveryCron, processDeliveryBatch } from '../lib/notifications/account-delivery-worker-core.ts';

const SECRET = 'cron-secret-value';
const request = (authorization?: string) => new Request('https://idoc.club/api/cron/account-delivery', { headers: authorization ? { authorization } : undefined });

test('cron rejects missing and invalid authentication before delivery', async () => {
  let calls = 0;
  const dependencies = { processBatch: async () => { calls += 1; return {}; }, reportFailure: () => undefined, secret: SECRET };
  assert.equal((await handleAccountDeliveryCron(request(), dependencies)).status, 401);
  assert.equal((await handleAccountDeliveryCron(request('Bearer wrong'), dependencies)).status, 401);
  assert.equal(calls, 0);
});

test('valid cron authentication invokes delivery and returns only its summary', async () => {
  let calls = 0;
  const response = await handleAccountDeliveryCron(request(`Bearer ${SECRET}`), {
    processBatch: async () => { calls += 1; return { delivered: 2, retryable: 1 }; },
    reportFailure: () => undefined,
    secret: SECRET,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { delivered: 2, retryable: 1 });
  assert.equal(calls, 1);
});

test('bounded batches process multiple records, continue after retry, and stop on empty', async () => {
  const results = ['delivered', 'retryable', 'delivered', 'empty'] as const;
  let calls = 0;
  const summary = await processDeliveryBatch(async () => ({ status: results[calls++] ?? 'empty' }));
  assert.deepEqual(summary, { deadLettered: 0, delivered: 2, ineligible: 0, leaseLost: 0, retryable: 1 });
  assert.equal(calls, 4);
  calls = 0;
  await processDeliveryBatch(async () => { calls += 1; return { status: 'delivered' }; });
  assert.equal(calls, ACCOUNT_DELIVERY_BATCH_LIMIT);
});

test('failure evidence and public responses contain no sensitive values', async () => {
  const evidence: unknown[] = [];
  const response = await handleAccountDeliveryCron(request(`Bearer ${SECRET}`), {
    processBatch: async () => { throw new Error('member@example.com token=raw decrypted payload'); },
    reportFailure: () => evidence.push({ category: 'operational' }),
    secret: SECRET,
  });
  const publicBody = await response.text();
  const visible = `${publicBody}${JSON.stringify(evidence)}`;
  assert.equal(response.status, 500);
  for (const sensitive of [SECRET, 'member@example.com', 'raw', 'decrypted payload']) assert.equal(visible.includes(sensitive), false);
});

test('Vercel Cron configuration matches the protected route', () => {
  const configuration = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(configuration.crons, [{ path: '/api/cron/account-delivery', schedule: '*/5 * * * *' }]);
  assert.ok(readFileSync(new URL('../app/api/cron/account-delivery/route.ts', import.meta.url), 'utf8').includes('handleAccountDeliveryCron'));
});
