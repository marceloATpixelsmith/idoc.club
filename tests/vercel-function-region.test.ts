import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('serverless functions are pinned next to the Oregon PostgreSQL database', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { regions?: string[] };
  assert.deepEqual(config.regions, ['pdx1']);
  const runbook = readFileSync('docs/07-administrator-and-operations-runbook.md', 'utf8');
  assert.match(runbook, /\*\*Function region\.\*\*[^\n]*pdx1/);
});
