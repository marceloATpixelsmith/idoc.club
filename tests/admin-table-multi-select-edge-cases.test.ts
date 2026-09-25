import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const toolbar = readFileSync(new URL('../components/data-table/data-table-toolbar.tsx', import.meta.url), 'utf8');
const canonicalize = readFileSync(new URL('../hooks/use-canonicalize-multi-select-params.ts', import.meta.url), 'utf8');
const memberTable = readFileSync(new URL('../app/(dashboard)/admin/members/members-table.tsx', import.meta.url), 'utf8');
const resourceTable = readFileSync(new URL('../components/admin/resource-data-table.tsx', import.meta.url), 'utf8');
const supportTable = readFileSync(new URL('../app/(dashboard)/admin/support/support-inbox-table.tsx', import.meta.url), 'utf8');
const dateRangeFilter = readFileSync(new URL('../components/admin/date-range-filter.tsx', import.meta.url), 'utf8');

test('the Reset button stays mounted and shows its spinner for the actual navigation duration, not an instantaneous local transition', () => {
  assert.match(toolbar, /pending\?: boolean;/);
  assert.match(toolbar, /const \[pendingReset, setPendingReset\] = React\.useState\(false\);/);
  assert.match(toolbar, /const showReset = isFiltered \|\| \(pending !== undefined && pendingReset\);/);
  assert.match(toolbar, /const isResetting = pendingReset && Boolean\(pending\);/);
  assert.match(toolbar, /\{showReset && \(/);
  assert.doesNotMatch(toolbar, /React\.useTransition\(\)/);
  for (const table of [memberTable, resourceTable, supportTable]) assert.match(table, /pending=\{isPending\}/);
});

test('a table that never reports pending state (synchronous, client-only filtering, e.g. AdminReadOnlyTable) never latches the reset button open -- it only follows isFiltered', () => {
  assert.match(toolbar, /if \(pending !== undefined\) setPendingReset\(true\);/);
  const readOnlyTable = readFileSync(new URL('../components/admin/admin-read-only-table.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(readOnlyTable, /pending=\{/);
});

test('a repeated multi-select query key is canonicalized to the toolbar\'s comma-joined form as soon as an admin table mounts, so client facet state matches what the server already applies', () => {
  assert.match(canonicalize, /export function useCanonicalizeMultiSelectParams\(keys: readonly string\[\]\)/);
  assert.match(canonicalize, /params\.getAll\(key\)/);
  assert.match(canonicalize, /values\.length > 1/);
  assert.match(canonicalize, /router\.replace\(`\$\{pathname\}\?\$\{params\}`, \{ scroll: false \}\)/);
  assert.match(memberTable, /useCanonicalizeMultiSelectParams\(MULTI_SELECT_PARAMS\)/);
  assert.match(memberTable, /const MULTI_SELECT_PARAMS = \['status', 'type', 'federation', 'country', 'region'\]/);
  assert.match(resourceTable, /const multiSelectParams = tableType === 'content_pages' \? \['status', 'audience'\] : \['status'\];/);
  assert.match(resourceTable, /useCanonicalizeMultiSelectParams\(multiSelectParams\)/);
  assert.match(supportTable, /useCanonicalizeMultiSelectParams\(MULTI_SELECT_PARAMS\)/);
  assert.match(supportTable, /const MULTI_SELECT_PARAMS = \['category', 'status', 'assigned'\]/);
});

test('Reset performs a single navigation that clears both the manual (search/date) fields and the facet-filter query params together, so the button\'s pending state reflects one real round trip instead of racing two separate transitions sharing the same isPending flag', () => {
  assert.match(memberTable, /onReset=\{\(\) => update\(\{ expiresFrom: undefined, expiresTo: undefined, q: undefined, \.\.\.Object\.fromEntries\(MULTI_SELECT_PARAMS\.map\(\(key\) => \[key, undefined\]\)\) \}\)\}/);
  assert.match(resourceTable, /onReset=\{\(\) => update\(\{ q: undefined, from: undefined, to: undefined, \.\.\.Object\.fromEntries\(multiSelectParams\.map\(\(key\) => \[key, undefined\]\)\) \}\)\}/);
  assert.match(supportTable, /onReset=\{\(\) => update\(\{ activityFrom: undefined, activityTo: undefined, q: undefined, \.\.\.Object\.fromEntries\(MULTI_SELECT_PARAMS\.map\(\(key\) => \[key, undefined\]\)\) \}\)\}/);
});

test('the toolbar Reset control stays available while a date-range popover holds an uncommitted draft, not only once a date range is actually committed to the URL', () => {
  assert.match(dateRangeFilter, /onDraftActiveChange\?: \(active: boolean\) => void;/);
  assert.match(dateRangeFilter, /const draftActive = open && Boolean\(draft\.from \|\| draft\.to\);/);
  assert.match(dateRangeFilter, /onDraftActiveChange\?\.\(draftActive\);/);
  assert.match(memberTable, /const \[dateDraftActive, setDateDraftActive\] = useState\(false\);/);
  assert.match(memberTable, /some\(\(key\) => searchParams\.has\(key\)\) \|\| dateDraftActive;/);
  assert.match(memberTable, /onDraftActiveChange=\{setDateDraftActive\}/);
  assert.match(resourceTable, /const \[dateDraftActive, setDateDraftActive\] = useState\(false\);/);
  assert.match(resourceTable, /\['from', 'to'\]\.some\(\(key\) => searchParams\.has\(key\)\) \|\| dateDraftActive;/);
  assert.match(resourceTable, /onDraftActiveChange=\{setDateDraftActive\}/);
  assert.match(supportTable, /const \[dateDraftActive, setDateDraftActive\] = useState\(false\);/);
  assert.match(supportTable, /activityFrom'\) \|\| searchParams\.get\('activityTo'\)\) \|\| dateDraftActive;/);
  assert.match(supportTable, /onDraftActiveChange=\{setDateDraftActive\}/);
});
