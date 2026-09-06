import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import test from 'node:test';

test('CI pins the declared pnpm version and blocks high dependency advisories', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-toolchain-policy.mjs'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /high-severity audit is blocking/);
});
