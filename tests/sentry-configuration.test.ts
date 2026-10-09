import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Sentry source maps target the existing Marketplace-linked project', () => {
  const config = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
  assert.match(config, /org: 'pixelsmith-platform'/);
  assert.match(config, /project: 'idoc'/);
  assert.doesNotMatch(config, /process\.env\.SENTRY_(?:ORG|PROJECT)/);

  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.doesNotMatch(example, /^SENTRY_(?:ORG|PROJECT)=/m);
});
