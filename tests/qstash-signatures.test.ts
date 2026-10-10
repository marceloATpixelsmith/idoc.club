import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { SignJWT } from 'jose';
import { verifyQStashRequest } from '../lib/background/qstash.ts';

const callback = 'https://staging.idoc.club/api/qstash/jobs';
const current = 'synthetic-current-key-for-qstash-signature-tests';
const next = 'synthetic-next-key-for-qstash-signature-tests';
const body = JSON.stringify({ job: 'account-delivery' });
const hash = createHash('sha256').update(body).digest('base64url');
const saved = {
  QSTASH_CALLBACK_BASE_URL: process.env.QSTASH_CALLBACK_BASE_URL,
  QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY,
  QSTASH_NEXT_SIGNING_KEY: process.env.QSTASH_NEXT_SIGNING_KEY,
};

before(() => {
  process.env.QSTASH_CALLBACK_BASE_URL = 'https://staging.idoc.club';
  process.env.QSTASH_CURRENT_SIGNING_KEY = current;
  process.env.QSTASH_NEXT_SIGNING_KEY = next;
});
after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function signature(secret: string, hashValue = hash, subject = callback) {
  return new SignJWT({ body: hashValue }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer('Upstash').setSubject(subject).setNotBefore('0s').setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}
function request(jwt: string) {
  return new Request(callback, { method: 'POST', headers: { 'Upstash-Signature': jwt, 'Content-Type': 'application/json' }, body });
}

test('accepts signed current and next QStash keys during key rotation', async () => {
  assert.equal(await verifyQStashRequest(request(await signature(current)), body), true);
  assert.equal(await verifyQStashRequest(request(await signature(next)), body), true);
});

test('rejects forged signatures, changed request body and wrong destination', async () => {
  assert.equal(await verifyQStashRequest(request(await signature('unknown-key')), body), false);
  assert.equal(await verifyQStashRequest(request(await signature(current)), '{"job":"clock-skew-check"}'), false);
  assert.equal(await verifyQStashRequest(request(await signature(current, hash, 'https://elsewhere.test/api/qstash/jobs')), body), false);
});

test('unsigned QStash requests never run', async () => {
  const unsigned = new Request(callback, { method: 'POST', body });
  assert.equal(await verifyQStashRequest(unsigned, body), false);
});

test('accepts a signature for the per-job destination URL used to label schedules', async () => {
  const labelled = `${callback}?job=account-delivery`;
  const req = new Request(labelled, { method: 'POST', headers: { 'Upstash-Signature': await signature(current, hash, labelled) }, body });
  assert.equal(await verifyQStashRequest(req, body), true);
  const other = new Request(`${callback}?job=clock-skew-check`, { method: 'POST', headers: { 'Upstash-Signature': await signature(current, hash, labelled) }, body });
  assert.equal(await verifyQStashRequest(other, body), false);
});
