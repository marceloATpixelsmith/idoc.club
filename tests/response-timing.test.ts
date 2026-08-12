import assert from 'node:assert/strict';
import test from 'node:test';
import { equalizeAnonymousResponse } from '../lib/security/response-timing.ts';

test('timing equalization uses an injectable deterministic floor and bounded jitter', async () => {
  const sleeps: number[] = [];
  await equalizeAnonymousResponse(1000, { now: () => 1100, random: () => 0.5, sleep: async (milliseconds) => { sleeps.push(milliseconds); } });
  assert.deepEqual(sleeps, [275]);
});

test('timing equalization does not sleep after work already exceeds its bound', async () => {
  let slept = false;
  await equalizeAnonymousResponse(1000, { now: () => 1500, random: () => 0, sleep: async () => { slept = true; } });
  assert.equal(slept, false);
});
