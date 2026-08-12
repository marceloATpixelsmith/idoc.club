import assert from 'node:assert/strict';
import test from 'node:test';
import {
  databaseUrlForServer,
  stripeKeyForServer,
} from '../lib/runtime/configuration.ts';

test('runtime privileged configuration remains mandatory', () => {
  assert.throws(() => databaseUrlForServer({}));
  assert.throws(() => stripeKeyForServer({}));
});

test('production compilation uses non-network build placeholders only during the build phase', () => {
  const environment = { NEXT_PHASE: 'phase-production-build' };
  assert.match(databaseUrlForServer(environment), /127\.0\.0\.1/);
  assert.match(stripeKeyForServer(environment), /^sk_test_build_time_/);
});

test('real runtime values are preserved', () => {
  assert.equal(
    databaseUrlForServer({ POSTGRES_URL: 'postgres://runtime' }),
    'postgres://runtime'
  );
  assert.equal(
    stripeKeyForServer({ STRIPE_SECRET_KEY: 'sk_live_runtime' }),
    'sk_live_runtime'
  );
});
