import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const toolbar = readFileSync(new URL('../components/data-table/data-table-toolbar.tsx', import.meta.url), 'utf8');
const canonicalize = readFileSync(new URL('../hooks/use-canonicalize-multi-select-params.ts', import.meta.url), 'utf8');
const memberTable = readFileSync(new URL('../app/(dashboard)/admin/members/members-table.tsx', import.meta.url), 'utf8');
const resourceTable = readFileSync(new URL('../components/admin/resource-data-table.tsx', import.meta.url), 'utf8');
const supportTable = readFileSync(new URL('../app/(dashboard)/admin/support/support-inbox-table.tsx', import.meta.url), 'utf8');

test('the Reset button stays mounted and shows its spinner for the actual navigation duration, not an instantaneous local transition', () => {
  assert.match(toolbar, /pending\?: boolean;/);
  assert.match(toolbar, /const \[pendingReset, setPendingReset\] = React\.useState\(false\);/);
  assert.match(toolbar, /const showReset = isFiltered \|\| pendingReset;/);
  assert.match(toolbar, /const isResetting = pendingReset && Boolean\(pending\);/);
  assert.match(toolbar, /\{showReset && \(/);
  assert.doesNotMatch(toolbar, /React\.useTransition\(\)/);
  for (const table of [memberTable, resourceTable, supportTable]) assert.match(table, /pending=\{isPending\}/);
});

test('a repeated multi-select query key is canonicalized to the toolbar\'s comma-joined form as soon as an admin table mounts, so client facet state matches what the server already applies', () => {
  assert.match(canonicalize, /export function useCanonicalizeMultiSelectParams\(keys: readonly string\[\]\)/);
  assert.match(canonicalize, /params\.getAll\(key\)/);
  assert.match(canonicalize, /values\.length > 1/);
  assert.match(canonicalize, /router\.replace\(`\$\{pathname\}\?\$\{params\}`, \{ scroll: false \}\)/);
  assert.match(memberTable, /useCanonicalizeMultiSelectParams\(MULTI_SELECT_PARAMS\)/);
  assert.match(memberTable, /const MULTI_SELECT_PARAMS = \['status', 'type', 'federation', 'country', 'region'\]/);
  assert.match(resourceTable, /useCanonicalizeMultiSelectParams\(tableType === 'content_pages' \? \['status', 'audience'\] : \['status'\]\)/);
  assert.match(supportTable, /useCanonicalizeMultiSelectParams\(MULTI_SELECT_PARAMS\)/);
  assert.match(supportTable, /const MULTI_SELECT_PARAMS = \['category', 'status', 'assigned'\]/);
});
