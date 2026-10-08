import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('QStash callback rejects unsigned calls and unknown job types', () => {
  const route = read('app/api/qstash/jobs/route.ts');
  assert.match(route, /verifyQStashRequest\(request, body\)/);
  assert.match(route, /status: 401/);
  assert.match(route, /Object\.prototype\.hasOwnProperty\.call\(QSTASH_JOBS, job\)/);
  assert.match(route, /handlers\[job as QStashJob\]/);
});

test('QStash signs destination and request body, and requires both rotation keys', () => {
  const source = read('lib/background/qstash.ts');
  assert.match(source, /jwtVerify\(signature/);
  assert.match(source, /issuer: 'Upstash'/);
  assert.match(source, /payload\.sub === destination/);
  assert.match(source, /payload\.body\.replace/);
  assert.match(source, /QSTASH_NEXT_SIGNING_KEY/);
  assert.match(source, /QSTASH_CURRENT_SIGNING_KEY/);
});

test('event enqueue paths dispatch only after database commits and prefer QStash', () => {
  const dispatcher = read('lib/notifications/immediate-dispatch.ts');
  assert.match(dispatcher, /publishQStashJob\(job\)/);
  assert.match(dispatcher, /await deliver\(\)/);
  assert.match(read('lib/membership/account-recovery.ts'), /processAccountDeliveryBatch\(1\), 'account-delivery'/);
  assert.match(read('lib/seminars/seminars.ts'), /processCanceledSeminarPayments\(\), 'seminar-cancellation-resolution'/);
});

test('Vercel staging builds register QStash schedules before removing crons', () => {
  const schedules = JSON.parse(read('vercel.json')) as { crons: Array<{path:string; schedule:string}> };
  assert.equal(schedules.crons.length, 0);
  assert.match(read('package.json'), /configure-qstash-schedules/);
  assert.match(read('scripts/configure-qstash-schedules.mjs'), /QSTASH_CALLBACK_BASE_URL/);
});
