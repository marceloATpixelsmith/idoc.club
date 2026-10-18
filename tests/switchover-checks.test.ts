import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateSwitchover, hostOf, type SwitchoverInputs } from '../lib/operations/switchover-checks-core.ts';

const ready: SwitchoverInputs = {
  baseUrlHost: 'idoc.club', counts: { legacyImports: 0, profiles: 0, subscriptions: 0, users: 0 }, googleRedirectHost: 'idoc.club', holdOn: true, ledgerApplied: 73, ledgerExpected: 73,
  legacyImportEnabled: true, legacyKeyPresent: true, qstashHost: 'idoc.club', reconciliationLiveEnabled: false, schema: 'idoc_production', stripeKeyMode: 'live',
  webhook: { missingEvents: [], state: 'ok' }, webhookSecretPresent: true,
};
const status = (input: SwitchoverInputs, id: string) => evaluateSwitchover(input).find((check) => check.id === id)?.status;

test('a fully prepared production is all ready', () => {
  assert.deepEqual(evaluateSwitchover(ready).filter((check) => check.status !== 'ok'), []);
});

test('today\'s production state shows what is left to do', () => {
  const today: SwitchoverInputs = { ...ready, baseUrlHost: 'redesign.idoc.club', counts: { legacyImports: 0, profiles: 4, subscriptions: 2, users: 8 }, googleRedirectHost: 'redesign.idoc.club', legacyImportEnabled: false, legacyKeyPresent: false, qstashHost: null, webhook: { missingEvents: [], state: 'disabled' } };
  assert.equal(status(today, 'data'), 'todo');
  assert.equal(status(today, 'domain-settings'), 'todo');
  assert.equal(status(today, 'webhook'), 'todo');
  assert.equal(status(today, 'import-switch'), 'todo');
  assert.match(evaluateSwitchover(today).find((check) => check.id === 'domain-settings')?.detail ?? '', /QSTASH_CALLBACK_BASE_URL \(not set\)/);
});

test('a test key, missing migrations, a released hold and the live-actions switch are flagged', () => {
  assert.equal(status({ ...ready, stripeKeyMode: 'test' }, 'stripe-key'), 'todo');
  assert.equal(status({ ...ready, ledgerApplied: 70 }, 'migrations'), 'todo');
  assert.equal(status({ ...ready, ledgerApplied: null }, 'migrations'), 'warn');
  assert.equal(status({ ...ready, holdOn: false }, 'hold'), 'warn');
  assert.equal(status({ ...ready, reconciliationLiveEnabled: true }, 'safeguard'), 'warn');
});

test('webhook states and non-production schemas are reported', () => {
  assert.equal(status({ ...ready, webhook: { missingEvents: ['invoice.paid'], state: 'partial' } }, 'webhook'), 'todo');
  assert.equal(status({ ...ready, webhook: { missingEvents: [], state: 'unavailable' } }, 'webhook'), 'warn');
  assert.equal(status({ ...ready, schema: 'idoc_staging' }, 'schema'), 'warn');
});

test('hostOf reads a hostname and tolerates bad input', () => {
  assert.equal(hostOf('https://idoc.club/api/x'), 'idoc.club');
  assert.equal(hostOf('not a url'), null);
  assert.equal(hostOf(undefined), null);
});
