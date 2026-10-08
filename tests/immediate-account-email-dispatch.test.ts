import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('verification codes remain synchronously delivered', () => {
  assert.match(read('lib/auth/email-otp.ts'), /await sendTransactionalEmail\(/);
});

test('durable account links dispatch only after the transaction commits', () => {
  const source = read('lib/membership/account-recovery.ts');
  const commit = source.indexOf("if (testFailureAt === 'before_commit')");
  const dispatch = source.indexOf('dispatchQueuedEmailAfterResponse(() => processAccountDeliveryBatch(1))');
  assert.ok(commit > 0 && dispatch > commit);
});

test('security and operational notifications kick workers for newly committed records', () => {
  for (const path of ['lib/notifications/auth-security-events.ts', 'lib/notifications/operational-alert-outbox.ts']) {
    assert.match(read(path), /if \(rows\[0\]\) dispatchQueuedEmailAfterResponse\(/);
  }
});

test('a persistent outbox and hourly recovery schedule remain after immediate dispatch', () => {
  const vercel = JSON.parse(read('vercel.json')) as { crons: { path: string; schedule: string }[] };
  assert.equal(vercel.crons.find((item) => item.path === '/api/cron/account-delivery')?.schedule, '0 * * * *');
  const source = read('lib/notifications/immediate-dispatch.ts');
  assert.match(source, /after\(async \(\) =>/);
  assert.match(source, /Sentry\.captureException\(error\)/);
});
