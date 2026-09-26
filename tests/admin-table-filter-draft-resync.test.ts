import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const facetedFilter = readFileSync(new URL('../components/data-table/data-table-faceted-filter.tsx', import.meta.url), 'utf8');
const dateRangeFilter = readFileSync(new URL('../components/admin/date-range-filter.tsx', import.meta.url), 'utf8');

test('a multi-select facet\'s draft re-syncs from the committed column filter value while the popover stays open, so browser back/forward navigating the URL underneath it isn\'t silently reverted on close', () => {
  assert.match(facetedFilter, /React\.useEffect\(\(\) => \{\s*\n\s*if \(open\) setDraftValues\(committedValues\);/);
  assert.match(facetedFilter, /\}, \[column, open, columnFilterValue\]\);/);
  assert.doesNotMatch(facetedFilter, /if \(next\) \{\s*\n\s*setDraftValues\(committedValues\);/);
});

test('the date-range filter\'s draft re-syncs from the committed from/to props while the popover stays open, so browser back/forward navigating the URL underneath it isn\'t silently reverted on close', () => {
  assert.match(dateRangeFilter, /useEffect\(\(\) => \{\s*\n\s*if \(open\) setDraft\(\{ from: fromDateKey\(from\), to: fromDateKey\(to\) \}\);/);
  assert.match(dateRangeFilter, /\}, \[from, to, open\]\);/);
  assert.doesNotMatch(dateRangeFilter, /if \(next\) \{\s*\n\s*setDraft\(committed\);/);
});
