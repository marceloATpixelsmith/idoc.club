import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isReactManaged } from '../lib/dom/react-hydration.ts';

test('a DOM node is React-managed only once React has attached its fiber property', () => {
  assert.equal(isReactManaged({}), false);
  assert.equal(isReactManaged({ className: 'x', 'data-foo': 'bar' }), false);
  assert.equal(isReactManaged({ __reactProps$abc123: {} }), false);
  assert.equal(isReactManaged({ __reactFiber$abc123: {} }), true);
});

test('the sitewide icon tooltips never edit an icon React has not hydrated, and retry until it has', () => {
  const tooltips = readFileSync('components/site/sitewide-icon-tooltips.tsx', 'utf8');
  assert.match(tooltips, /import \{ isReactManaged \} from '@\/lib\/dom\/react-hydration'/);
  // The guard sits before the title is created, and a skipped icon is reported back for a retry.
  assert.match(tooltips, /if \(!isReactManaged\(svg\)\) return false;[\s\S]*?createElementNS\([^)]*'title'\)/);
  assert.match(tooltips, /RETRY_LIMIT/);
  assert.match(tooltips, /window\.clearTimeout\(timer\)/);
  assert.match(tooltips, /observer\.disconnect\(\)/);
});
