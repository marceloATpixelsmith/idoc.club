import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { hasBlockingHighAudit } from '../scripts/validate-toolchain-policy.mjs';

test('CI pins the declared pnpm version and blocks high dependency advisories', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-toolchain-policy.mjs'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /high-severity audit is blocking/);
});

test('the audit validator rejects a step-level continue-on-error bypass', () => {
  const workflow = `steps:
  - run: pnpm audit --audit-level=high
    continue-on-error: true
  - run: pnpm typecheck
`;
  assert.equal(hasBlockingHighAudit(workflow), false);
});

test('the audit validator accepts an unbypassed high-severity audit step', () => {
  const workflow = `steps:
  - run: pnpm audit --audit-level=high
  - run: pnpm typecheck
`;
  assert.equal(hasBlockingHighAudit(workflow), true);
});
