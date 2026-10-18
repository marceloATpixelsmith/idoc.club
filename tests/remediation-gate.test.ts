import assert from 'node:assert/strict';
import test from 'node:test';
import { remediationAllowed } from '../lib/payments/remediation-gate.ts';

const live = {
  BASE_URL: 'https://idoc.club',
  DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'false',
  STRIPE_SECRET_KEY: `sk_live_${'a'.repeat(24)}`,
  VERCEL_ENV: 'production',
};

test('Stripe cleanup is allowed in the live production deployment with billing released', () => {
  assert.equal(remediationAllowed(live, 'idoc_production'), true);
});

test('Stripe cleanup is allowed on the production schema served from a test-mode deployment with a test key (the Stripe sandbox), even while the hold is on', () => {
  const testMode = { ...live, BASE_URL: 'https://redesign.idoc.club', DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'true', STRIPE_SECRET_KEY: `sk_test_${'a'.repeat(24)}` };
  assert.equal(remediationAllowed(testMode, 'idoc_production'), true);
  assert.equal(remediationAllowed(testMode, 'idoc_staging'), false);
});

for (const [name, environment, schema] of [
  ['the staging schema', live, 'idoc_staging'],
  ['the legacy schema', live, 'idoc'],
  ['billing still on hold', { ...live, DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'true' }, 'idoc_production'],
  ['the hold unset (fails closed)', { ...live, DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: undefined }, 'idoc_production'],
  ['a test key', { ...live, STRIPE_SECRET_KEY: `sk_test_${'a'.repeat(24)}` }, 'idoc_production'],
  ['a preview deployment', { ...live, VERCEL_ENV: 'preview' }, 'idoc_production'],
  ['a production deployment on a non-live hostname', { ...live, BASE_URL: 'https://redesign.idoc.club' }, 'idoc_production'],
] as const) {
  test(`Stripe cleanup stays off: ${name}`, () => {
    assert.equal(remediationAllowed(environment, schema), false);
  });
}
