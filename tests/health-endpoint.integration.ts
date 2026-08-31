import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { GET } from '../app/api/health/route.ts';
import { closeHarness, resetIdoc } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('the health endpoint reports ok with a no-store header when the database is reachable, and exposes nothing beyond status', async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['status']);
  assert.equal(body.status, 'ok');
});
