import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('app/(dashboard)/onboarding/onboarding-wizard.tsx', 'utf8');

test('profile creation remains disabled until all required details and consents are complete', () => {
  assert.match(source, /form\.checkValidity\(\)/);
  assert.match(source, /getAll\('judgeStatus'\)\.length === 0/);
  assert.match(source, /getAll\('stewardStatus'\)\.length === 0/);
  assert.match(source, /disabled=\{pending \|\| !detailsComplete\}/);
  assert.match(source, /<ConsentCheckbox name="termsAccepted" required>/);
  assert.match(source, /<ConsentCheckbox name="privacyAccepted" required>/);
});

test('readiness is recomputed for restored and browser-autofilled form values', () => {
  assert.match(source, /useRef<HTMLFormElement>\(null\)/);
  assert.match(source, /ref=\{detailsFormRef\}/);
  assert.match(source, /syncReadiness\(\);/);
  assert.match(source, /requestAnimationFrame\(syncReadiness\)/);
  assert.match(source, /setTimeout\(syncReadiness, 250\)/);
  assert.match(source, /setTimeout\(syncReadiness, 1000\)/);
  assert.match(source, /addEventListener\('pageshow', syncReadiness\)/);
});

test('onboarding field and section labels use bold emphasis', () => {
  for (const label of [
    'Country',
    'Official information',
    'National Federation',
    'IDOC Region',
    'FEI ID',
    'Official status as Judge',
    'Official status as Steward',
    'Are you a Technical Delegate?',
    'Consent',
  ]) {
    assert.ok(source.includes(label), `missing onboarding label: ${label}`);
  }
  assert.ok((source.match(/font-bold/g) ?? []).length >= 8, 'expected bold field and section labels');
});

test('going back to classification clears stale form readiness', () => {
  assert.match(source, /setDetailsComplete\(false\); setStep\('type'\)/);
  assert.match(source, /setClassification\(option\.value\); setDetailsComplete\(false\)/);
});
