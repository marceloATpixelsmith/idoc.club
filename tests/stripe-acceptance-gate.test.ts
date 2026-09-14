import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('Stripe acceptance manifest maps unique requirements to named behavioral scenarios and specific manual-only boundaries', () => {
  const manifest = JSON.parse(readFileSync('docs/27-stripe-payment-acceptance-gate.json', 'utf8')) as {
    manualOnly: Array<{ id: string; reason: string }>;
    requirements: Array<{ id: string; scenarios: Array<{ execution: string; id: string; test: { name: string; path: string } }> }>;
  };
  assert.ok(manifest.requirements.length > 0);
  assert.equal(new Set(manifest.requirements.map(({ id }) => id)).size, manifest.requirements.length);
  const scenarios = manifest.requirements.flatMap(({ scenarios }) => scenarios);
  assert.equal(new Set(scenarios.map(({ id }) => id)).size, scenarios.length);
  assert.ok(scenarios.every(({ execution, test: mapped }) => ['local', 'stripe-test-mode'].includes(execution) && mapped.name && mapped.path));
  assert.ok(manifest.manualOnly.every(({ id, reason }) => id.startsWith('MANUAL-') && /requires/i.test(reason) && reason.length >= 60));
});

test('the production Stripe acceptance validator passes the repository evidence', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-stripe-acceptance-gate.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not test execution or provider evidence/);
});

test('the scenario validator gives actionable requirement, scenario, path, behavior, and evidence failures', () => {
  const manifest = JSON.parse(readFileSync('docs/27-stripe-payment-acceptance-gate.json', 'utf8'));
  const scenario = manifest.requirements[0].scenarios[0];
  scenario.test.path = 'tests/does-not-exist.spec.ts';
  const directory = mkdtempSync(join(tmpdir(), 'idoc-stripe-gate-'));
  const path = join(directory, 'manifest.json');
  writeFileSync(path, JSON.stringify(manifest));
  const result = spawnSync(process.execPath, ['scripts/validate-stripe-acceptance-gate.mjs', path], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requirement=STRIPE-CHECKOUT scenario=MEMBERSHIP-ONE-TIME test=tests\/does-not-exist\.spec\.ts missing=mapped test file; expected=/);
});

test('the full acceptance gate fails closed when provider execution is not explicitly enabled', () => {
  const env = { ...process.env };
  delete env.STRIPE_E2E_ENABLED;
  const result = spawnSync(process.execPath, ['scripts/run-stripe-acceptance-gate.mjs'], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /STRIPE_E2E_ENABLED=true/);
});
