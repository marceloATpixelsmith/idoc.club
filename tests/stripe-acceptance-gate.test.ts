import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Stripe acceptance manifest covers ten executable groups and specific manual-only boundaries', () => {
  const manifest = JSON.parse(readFileSync('docs/27-stripe-payment-acceptance-gate.json', 'utf8')) as {
    manualOnly: Array<{ id: string; reason: string }>;
    requirements: Array<{ id: string; tests: string[] }>;
  };
  assert.equal(manifest.requirements.length, 10);
  assert.equal(new Set(manifest.requirements.map(({ id }) => id)).size, 10);
  assert.ok(manifest.requirements.every(({ tests }) => tests.length > 0));
  assert.ok(manifest.manualOnly.every(({ reason }) => /requires/i.test(reason) && reason.length >= 40));
});

test('the production Stripe acceptance validator passes the repository evidence', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-stripe-acceptance-gate.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /10 automatable groups/);
});
