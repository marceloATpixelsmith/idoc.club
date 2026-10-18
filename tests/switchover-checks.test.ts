import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateSwitchover, hostOf, type SwitchoverInputs } from '../lib/operations/switchover-checks-core.ts';

const ready: SwitchoverInputs = {
  baseUrlHost: 'idoc.club', counts: { legacyImports: 0, profiles: 0, subscriptions: 0, users: 0 }, googleRedirectHost: 'idoc.club', holdOn: true, ledgerNewest: 1792350000000, journalNewest: 1792350000000, stagingNewest: 1792350000000,
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
  assert.equal(status({ ...ready, ledgerNewest: 1792340000000 }, 'migrations'), 'todo');
  assert.equal(status({ ...ready, stagingNewest: 1792340000000 }, 'migrations'), 'todo');
  assert.equal(status({ ...ready, ledgerNewest: 1792360000000, stagingNewest: undefined }, 'migrations'), 'warn');
  assert.equal(status({ ...ready, ledgerNewest: null }, 'migrations'), 'warn');
  assert.equal(status({ ...ready, stagingNewest: null }, 'migrations'), 'warn');
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

import { evaluateFinal, type FinalInputs } from '../lib/operations/switchover-checks-core.ts';

const done: FinalInputs = {
  deadLetteredOther: 0, heldEventsPending: 0, hold: false, importRun: { at: '2026-10-22T10:00:00Z', imported: 1500, payments: 6000, subscriptions: 900 }, keyMode: 'live', legacyImportEnabled: false,
  legacyKeyPresent: false, liveActionsEnabled: false, members: { payments: 6000, profiles: 1500, subscriptionsByStatus: { active: 900 }, users: 1500 }, openFindings: {}, outboxPending: 0,
  replayRun: { at: '2026-10-22T11:00:00Z', failed: 0, processed: 3 }, scanAt: '2026-10-22T11:30:00Z', webhook: 'ok', webhookEventsLast24h: 5,
};
const finalStatus = (input: FinalInputs, id: string) => evaluateFinal(input).find((check) => check.id === id)?.status;

test('a finished switchover verifies clean', () => {
  assert.deepEqual(evaluateFinal(done).filter((check) => check.status !== 'ok'), []);
});

test('final verification reports every unfinished or risky item', () => {
  assert.equal(finalStatus({ ...done, importRun: null }, 'final-import'), 'todo');
  assert.equal(finalStatus({ ...done, legacyKeyPresent: true }, 'final-import-off'), 'todo');
  assert.equal(finalStatus({ ...done, hold: true }, 'final-hold'), 'todo');
  assert.equal(finalStatus({ ...done, heldEventsPending: 4 }, 'final-held-events'), 'todo');
  assert.equal(finalStatus({ ...done, replayRun: { at: 'x', failed: 2, processed: 1 } }, 'final-replay'), 'warn');
  assert.equal(finalStatus({ ...done, scanAt: null }, 'final-scan'), 'todo');
  assert.equal(finalStatus({ ...done, openFindings: { orphaned_subscription: 3 } }, 'final-findings'), 'warn');
  assert.equal(finalStatus({ ...done, liveActionsEnabled: true }, 'final-safeguard'), 'warn');
  assert.equal(finalStatus({ ...done, deadLetteredOther: 1 }, 'final-queues'), 'warn');
  assert.equal(finalStatus({ ...done, keyMode: 'test' }, 'final-stripe'), 'todo');
  assert.equal(finalStatus({ ...done, webhookEventsLast24h: 0 }, 'final-stripe'), 'warn');
  assert.match(evaluateFinal({ ...done, openFindings: { orphaned_subscription: 3, refund_conflict: 1 } }).find((check) => check.id === 'final-findings')?.detail ?? '', /3 orphaned subscription, 1 refund conflict/);
});

test('after the import, absent import credentials are the finished state', () => {
  const after = { ...ready, counts: { ...ready.counts, legacyImports: 1, users: 1500 }, legacyImportEnabled: false, legacyKeyPresent: false };
  assert.equal(status(after, 'import-switch'), 'ok');
  assert.equal(status(after, 'import-key'), 'ok');
  assert.equal(status({ ...after, legacyKeyPresent: true }, 'import-key'), 'todo');
  assert.equal(status({ ...ready, legacyImportEnabled: false }, 'import-switch'), 'todo');
});
