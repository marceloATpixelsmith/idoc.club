import assert from 'node:assert/strict';
import test from 'node:test';

import type { FinalInputs, SwitchoverInputs } from '../lib/operations/switchover-checks-core.ts';
import { buildGuide, currentStepId, type GuideInputs } from '../lib/operations/switchover-guide-core.ts';

// Production as it is before the switchover: redesign host, test Stripe, test data present, hold on.
const before: SwitchoverInputs = {
  baseUrlHost: 'redesign.idoc.club', brevoWebhookKeyPresent: false, counts: { legacyImports: 0, profiles: 4, subscriptions: 2, users: 8 }, googleRedirectHost: 'redesign.idoc.club', holdOn: true,
  journalNewest: 10, ledgerNewest: 10, legacyImportEnabled: false, legacyKeyPresent: false, qstashHost: 'redesign.idoc.club', reconciliationLiveEnabled: false, schema: 'idoc_production',
  stagingNewest: 10, stripeKeyMode: 'test', webhook: { missingEvents: [], state: 'missing' }, webhookSecretPresent: true,
};
const finalBefore: FinalInputs = {
  deadLetteredOther: 0, heldEventsPending: 0, hold: true, importRun: null, keyMode: 'test', legacyImportEnabled: false, legacyKeyPresent: false, liveActionsEnabled: false,
  members: { payments: 0, profiles: 4, subscriptionsByStatus: { active: 2 }, users: 8 }, openFindings: {}, outboxPending: 0, replayRun: null, scanAt: null, webhook: 'missing', webhookEventsLast24h: 0,
};
const guide = (inputs: Partial<SwitchoverInputs> = {}, final: Partial<FinalInputs> = {}, host: string | null = 'redesign.idoc.club'): GuideInputs => ({ final: { ...finalBefore, ...final }, host, inputs: { ...before, ...inputs } });
const byId = (input: GuideInputs, id: string) => buildGuide(input).find((step) => step.id === id)!;

test('the steps are in order, uniquely numbered, and every step says what to do', () => {
  const steps = buildGuide(guide());
  assert.deepEqual(steps.map((step) => step.id), ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13']);
  for (const step of steps) assert.ok(step.actions.length > 0 && step.title && step.where, step.id);
});

test('no step carries a secret value, only names, scopes and instructions', () => {
  const text = JSON.stringify(buildGuide(guide()));
  assert.doesNotMatch(text, /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/);
});

test('today\'s production leaves test data, the Stripe split and the webhook key to do first', () => {
  const steps = buildGuide(guide());
  assert.equal(steps.find((step) => step.id === 'A2')!.autoDone, false);
    assert.equal(currentStepId(steps, new Set()), 'A2');
});

test('ticking manual steps and clearing the data moves the walkthrough along', () => {
  const steps = buildGuide(guide({ brevoWebhookKeyPresent: true, counts: { legacyImports: 0, profiles: 0, subscriptions: 0, users: 0 } }));
  assert.equal(currentStepId(steps, new Set()), 'A3');
  assert.equal(currentStepId(steps, new Set(['A3'])), 'A4');
  assert.equal(currentStepId(steps, new Set(['A3', 'A4'])), 'A5');
  assert.equal(currentStepId(steps, new Set(['A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'B1', 'B2'])), 'B3');
});

test('B3 is done only when the domain settings, live Stripe and the importer are all in effect', () => {
  const live = { baseUrlHost: 'idoc.club', googleRedirectHost: 'idoc.club', qstashHost: 'idoc.club', legacyImportEnabled: true, legacyKeyPresent: true, stripeKeyMode: 'live' as const };
  assert.equal(byId(guide(live), 'B3').autoDone, true);
  assert.equal(byId(guide({ ...live, stripeKeyMode: 'test' }), 'B3').autoDone, false);
  assert.equal(byId(guide({ ...live, qstashHost: 'redesign.idoc.club' }), 'B3').autoDone, false);
  assert.equal(byId(guide({ ...live, legacyKeyPresent: false }), 'B3').autoDone, false);
  const afterImport = { ...live, counts: { legacyImports: 1, profiles: 1, subscriptions: 1, users: 1 }, legacyImportEnabled: false, legacyKeyPresent: false };
  assert.equal(byId(guide(afterImport), 'B3').autoDone, true);
  assert.equal(byId(guide({ ...afterImport, stripeKeyMode: 'test' }), 'B3').autoDone, false);
  assert.equal(byId(guide({ ...afterImport, baseUrlHost: 'redesign.idoc.club' }), 'B3').autoDone, false);
});

test('DNS is seen as done when the page is loaded from the live domain', () => {
  assert.equal(byId(guide(), 'B4').autoDone, false);
  assert.equal(byId(guide({}, {}, 'idoc.club'), 'B4').autoDone, true);
  assert.equal(byId(guide({}, {}, 'www.idoc.club'), 'B4').autoDone, true);
});

test('import, webhook, hold, replay, scan and clean-up are each detected from the live site', () => {
  const imported = { counts: { legacyImports: 1, profiles: 1500, subscriptions: 900, users: 1500 } };
  assert.equal(byId(guide(imported), 'B6').autoDone, true);
  assert.equal(byId(guide({ ...imported, webhook: { missingEvents: [], state: 'ok' } }), 'B8').autoDone, true);
  assert.equal(byId(guide({ ...imported, holdOn: false }), 'B9').autoDone, true);
  const run = { at: '2026-10-22T10:00:00Z', imported: 1, payments: 1, subscriptions: 1 };
  assert.equal(byId(guide(imported, { replayRun: { at: '2026-10-22T12:00:00Z', failed: 0, processed: 2 }, importRun: run }), 'B10').autoDone, true);
  assert.equal(byId(guide(imported, { replayRun: { at: '2026-10-20T12:00:00Z', failed: 0, processed: 2 }, importRun: run }), 'B10').autoDone, false);
  const replay = { at: '2026-10-22T12:00:00Z', failed: 0, processed: 2 };
  assert.equal(byId(guide(imported, { importRun: run, replayRun: replay, scanAt: '2026-10-22T11:00:00Z' }), 'B11').autoDone, false);
  assert.equal(byId(guide(imported, { importRun: run, replayRun: replay, scanAt: '2026-10-22T13:00:00Z' }), 'B11').autoDone, true);
  assert.equal(byId(guide(imported, { importRun: run, replayRun: { ...replay, failed: 1 } }), 'B10').autoDone, false);
  assert.equal(byId(guide(imported), 'B12').autoDone, true);
  assert.equal(byId(guide({ ...imported, legacyKeyPresent: true }), 'B12').autoDone, false);
});

test('the final step needs everything finished', () => {
  const imported = { counts: { legacyImports: 1, profiles: 1, subscriptions: 1, users: 1 }, holdOn: false };
  const done = { hold: false, importRun: { at: 'a', imported: 1, payments: 1, subscriptions: 1 }, keyMode: 'live' as const, replayRun: { at: 'b', failed: 0, processed: 1 }, scanAt: 'c' };
  assert.equal(byId(guide(imported, done), 'B13').autoDone, true);
  assert.equal(byId(guide(imported, { ...done, heldEventsPending: 2 }), 'B13').autoDone, false);
  assert.equal(byId(guide(imported, { ...done, keyMode: 'test' }), 'B13').autoDone, false);
});
