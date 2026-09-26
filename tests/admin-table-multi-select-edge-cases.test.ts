import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const toolbar = readFileSync(new URL('../components/data-table/data-table-toolbar.tsx', import.meta.url), 'utf8');
const memberTable = readFileSync(new URL('../app/(dashboard)/admin/members/members-table.tsx', import.meta.url), 'utf8');
const resourceTable = readFileSync(new URL('../components/admin/resource-data-table.tsx', import.meta.url), 'utf8');
const supportTable = readFileSync(new URL('../app/(dashboard)/admin/support/support-inbox-table.tsx', import.meta.url), 'utf8');
const dateRangeFilter = readFileSync(new URL('../components/admin/date-range-filter.tsx', import.meta.url), 'utf8');
const facetedFilter = readFileSync(new URL('../components/data-table/data-table-faceted-filter.tsx', import.meta.url), 'utf8');
const viewOptions = readFileSync(new URL('../components/data-table/data-table-view-options.tsx', import.meta.url), 'utf8');
const sortList = readFileSync(new URL('../components/data-table/data-table-sort-list.tsx', import.meta.url), 'utf8');
const dataTableLib = readFileSync(new URL('../lib/data-table.ts', import.meta.url), 'utf8');

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

test('every column filter (status/type/category/etc.) is tracked as react-table\'s own local columnFilters state, comma-joined into a single preference field when persisted -- there is no URL to canonicalize a repeated key against anymore', () => {
  assert.doesNotMatch(memberTable, /useSearchParams/);
  assert.doesNotMatch(resourceTable, /useSearchParams/);
  assert.doesNotMatch(supportTable, /useSearchParams/);
  for (const table of [memberTable, resourceTable, supportTable]) {
    assert.match(table, /function filterToken\(columnFilters: ColumnFiltersState, id: string\): string \| undefined \{/);
    assert.match(table, /list\.length \? list\.join\(','\) : undefined;/);
  }
});

test('Reset atomically clears search, date-range, and column filters together in one persist+refresh call, so the button\'s pending state reflects one real round trip instead of racing separate updates', () => {
  assert.match(memberTable, /function resetAll\(\) \{/);
  assert.match(memberTable, /table\.resetColumnFilters\(\);/);
  assert.match(memberTable, /\{ expiresFrom: undefined, expiresTo: undefined, q: undefined \},/);
  assert.match(memberTable, /onReset=\{resetAll\}/);
  assert.match(resourceTable, /function resetAll\(\) \{/);
  assert.match(resourceTable, /\{ from: undefined, to: undefined, q: undefined \},/);
  assert.match(resourceTable, /onReset=\{resetAll\}/);
  assert.match(supportTable, /function resetAll\(\) \{/);
  assert.match(supportTable, /\{ activityFrom: undefined, activityTo: undefined, q: undefined \},/);
  assert.match(supportTable, /onReset=\{resetAll\}/);
});

test('the toolbar Reset control stays available while a date-range popover holds an uncommitted draft, not only once a date range is actually persisted', () => {
  assert.match(dateRangeFilter, /onDraftActiveChange\?: \(active: boolean\) => void;/);
  assert.match(dateRangeFilter, /const draftActive = open && Boolean\(draft\.from \|\| draft\.to\);/);
  assert.match(dateRangeFilter, /onDraftActiveChange\?\.\(draftActive\);/);
  assert.match(memberTable, /const \[dateDraftActive, setDateDraftActive\] = useState\(false\);/);
  assert.match(memberTable, /const manuallyFiltered = Boolean\(expiresFrom \|\| expiresTo\) \|\| dateDraftActive;/);
  assert.match(memberTable, /onDraftActiveChange=\{setDateDraftActive\}/);
  assert.match(resourceTable, /const \[dateDraftActive, setDateDraftActive\] = useState\(false\);/);
  assert.match(resourceTable, /const manuallyFiltered = Boolean\(from \|\| to\) \|\| dateDraftActive;/);
  assert.match(resourceTable, /onDraftActiveChange=\{setDateDraftActive\}/);
  assert.match(supportTable, /const \[dateDraftActive, setDateDraftActive\] = useState\(false\);/);
  assert.match(supportTable, /const manuallyFiltered = Boolean\(activityFrom \|\| activityTo\) \|\| dateDraftActive;/);
  assert.match(supportTable, /onDraftActiveChange=\{setDateDraftActive\}/);
});

test('clicking Reset while a date draft is uncommitted (from/to were already absent, so they don\'t change value) still force-clears the draft via an explicit resetSignal, instead of leaving it to be silently re-committed when the popover later closes', () => {
  assert.match(dateRangeFilter, /resetSignal\?: number;/);
  assert.match(dateRangeFilter, /if \(resetSignal !== undefined\) \{\s*\n\s*setDraft\(\{ from: undefined, to: undefined \}\);\s*\n\s*setOpen\(false\);/);
  assert.match(memberTable, /const \[dateResetSignal, setDateResetSignal\] = useState\(0\);/);
  assert.match(memberTable, /setDateResetSignal\(\(signal\) => signal \+ 1\);/);
  assert.match(memberTable, /resetSignal=\{dateResetSignal\}/);
  assert.match(resourceTable, /const \[dateResetSignal, setDateResetSignal\] = useState\(0\);/);
  assert.match(resourceTable, /setDateResetSignal\(\(signal\) => signal \+ 1\);/);
  assert.match(resourceTable, /resetSignal=\{dateResetSignal\}/);
  assert.match(supportTable, /const \[dateResetSignal, setDateResetSignal\] = useState\(0\);/);
  assert.match(supportTable, /setDateResetSignal\(\(signal\) => signal \+ 1\);/);
  assert.match(supportTable, /resetSignal=\{dateResetSignal\}/);
});

test('a toolbar-level Reset click while the date popover is open does not race a stale draft commit onto the URL, since Radix\'s outside-pointerdown dismissal (which fires before Reset\'s own click handler) is suppressed for that specific interaction', () => {
  assert.match(dateRangeFilter, /const onPointerDownOutside: React\.ComponentProps<typeof PopoverContent>\['onPointerDownOutside'\] = \(event\) => \{/);
  assert.match(dateRangeFilter, /\(event\.target as Element \| null\)\?\.closest\('\[aria-label="Reset filters"\]'\)\) event\.preventDefault\(\);/);
  assert.match(dateRangeFilter, /onPointerDownOutside=\{onPointerDownOutside\}/);
});

test('a toolbar-level Reset click while a multi-select facet popover is open does not get its own commit-then-unmount race either, matching the same outside-pointerdown guard already applied to the date-range filter', () => {
  assert.match(facetedFilter, /const onPointerDownOutside: React\.ComponentProps<typeof PopoverContent>\["onPointerDownOutside"\] = \(event\) => \{/);
  assert.match(facetedFilter, /\(event\.target as Element \| null\)\?\.closest\('\[aria-label="Reset filters"\]'\)\) event\.preventDefault\(\);/);
  assert.match(facetedFilter, /onPointerDownOutside=\{onPointerDownOutside\}/);
});

test('the column-visibility/order persist-on-change effect is a real useEffect, not a useMemo -- React may invoke a useMemo factory more than once per commit (Strict Mode\'s dev-mode double-invoke exists specifically to catch this), so persistAndRefresh (a real side effect: a network PUT plus router.refresh()) run from inside one can fire spuriously on mount or fire twice for one real change', () => {
  for (const table of [memberTable, resourceTable, supportTable]) {
    assert.match(table, /const skipNextColumnPersist = useRef\(true\);/);
    assert.match(table, /useEffect\(\(\) => \{\s*\n\s*if \(skipNextColumnPersist\.current\)/);
  }
});

test('hiding a column in the View popover only clears sorting when that column was actually being sorted, since an unconditional setSorting call fires the sort query state\'s own full-page navigation on every hide -- even for a column nobody sorted by -- and that navigation can race and clobber the separate effect that persists the real column-visibility change, snapping the just-unchecked column back to visible and its checkbox back to checked', () => {
  assert.doesNotMatch(viewOptions, /column\.toggleVisibility\(nextVisible\);\s*\n\s*if \(!nextVisible\) table\.setSorting/);
  assert.match(viewOptions, /if \(!nextVisible && table\.getState\(\)\.sorting\.some\(\(item\) => item\.id === column\.id\)\) \{/);
  assert.match(viewOptions, /table\.setSorting\(\(sorting\) => sorting\.filter\(\(item\) => item\.id !== column\.id\)\);/);
});

test('saved facet filters (status/type/country/federation/region, status/audience, category/status/assigned) are hydrated into each table\'s initial columnFilters, since the server applies them from saved preferences regardless -- otherwise the toolbar shows no active facets while the table is already filtered, and the next unrelated change persists undefined for them, silently clearing the saved view', () => {
  assert.match(memberTable, /\{ id: 'type', value: filters\.membershipTypes \?\? \[\] \}/);
  assert.match(memberTable, /\{ id: 'status', value: filters\.statuses \?\? \[\] \}/);
  assert.match(memberTable, /\{ id: 'federation', value: filters\.federations \?\? \[\] \}/);
  assert.match(memberTable, /\{ id: 'country', value: filters\.countries \?\? \[\] \}/);
  assert.match(memberTable, /\{ id: 'region', value: filters\.regions \?\? \[\] \}/);
  assert.match(resourceTable, /\{ id: 'status', value: initialStatus \? initialStatus\.split\(','\) : \[\] \}/);
  assert.match(resourceTable, /\{ id: 'audience', value: initialAudience \? initialAudience\.split\(','\) : \[\] \}/);
  assert.match(supportTable, /\{ id: 'category', value: filters\.category \? filters\.category\.split\(','\) : \[\] \}/);
  assert.match(supportTable, /\{ id: 'status', value: filters\.status \? filters\.status\.split\(','\) : \[\] \}/);
  assert.match(supportTable, /\{ id: 'assigned', value: filters\.assigned \? filters\.assigned\.split\(','\) : \[\] \}/);
  for (const table of [memberTable, resourceTable, supportTable]) assert.match(table, /initialState: \{ columnFilters: initialColumnFilters,/);
});

test('a manual filter change (search text, date range) resets pagination to page 1 in all three table wrappers -- otherwise staying on a stale page index against a narrower result set can show an empty table, or even "Page N of 1"', () => {
  for (const table of [memberTable, resourceTable, supportTable]) {
    assert.match(table, /table\.setPageIndex\(0\);/);
    assert.match(table, /pagination: \{ \.\.\.table\.getState\(\)\.pagination, pageIndex: 0 \}/);
  }
});

test('persistAndRefresh in every table wrapper sequences router.refresh() after the preference-write promise settles, rather than firing it concurrently with a fire-and-forget PUT -- otherwise a refresh can render before the write commits, and the completed write triggers no follow-up refresh, leaving controls and results inconsistent', () => {
  assert.match(memberTable, /\}\)\.finally\(\(\) => startTransition\(\(\) => router\.refresh\(\)\)\);/);
  assert.match(resourceTable, /\.catch\(\(\) => setError\('Table preferences could not be saved\.'\)\)\.finally\(\(\) => startTransition\(\(\) => router\.refresh\(\)\)\);/);
  assert.match(supportTable, /\}\)\.finally\(\(\) => startTransition\(\(\) => router\.refresh\(\)\)\);/);
});

test('useDataTable\'s notify cancels any pending debounced snapshot before dispatching an immediate one, since otherwise an older queued snapshot (e.g. from closing a facet popover) can fire after a newer immediate change (e.g. a sort click within the debounce window) and revert it', () => {
  const dataTableHook = readFileSync(new URL('../hooks/use-data-table.ts', import.meta.url), 'utf8');
  const debouncedCallback = readFileSync(new URL('../hooks/use-debounced-callback.ts', import.meta.url), 'utf8');
  assert.match(debouncedCallback, /return React\.useMemo\(\(\) => Object\.assign\(setValue, \{ cancel \}\), \[setValue, cancel\]\);/);
  assert.match(dataTableHook, /if \(immediate\) \{[\s\S]*?debouncedNotify\.cancel\(\);\s*\n\s*onLiveStateChange\?\.\(state\);\s*\n\s*\} else debouncedNotify\(state\);/);
});

test('getColumnPinningStyle no longer forces `background: var(--background)` inline on every cell regardless of pinning -- an inline style always wins over CSS classes, so this previously overrode the header row\'s --surface-raised band and any body row\'s hover/selected highlight on every table, pinned or not; only a pinned column (which needs an opaque backdrop for the content scrolling under it) still gets one', () => {
  assert.doesNotMatch(dataTableLib, /background: isPinned \? "var\(--background\)" : "var\(--background\)"/);
  assert.match(dataTableLib, /background: isPinned \? "var\(--background\)" : undefined,/);
});

test('View popover, faceted-filter, date-range-filter, and sort-list toolbar buttons are all h-8, matching the toolbar search Input\'s own h-8 -- previously only the View button set an explicit height, leaving every other outline-variant trigger at the Button component\'s h-9 default and visibly taller than the search box beside it', () => {
  assert.match(facetedFilter, /className="h-8 border-dashed font-normal"/);
  assert.match(dateRangeFilter, /className="h-8 border-dashed font-normal"/);
  assert.match(sortList, /className="h-8 font-normal"/);
});

test('the toolbar Reset control is icon-only (just the X/spinner, no "Reset" label) at icon-sm size, so it fits on the same line as the filter pills instead of wrapping', () => {
  assert.match(toolbar, /size="icon-sm"/);
  assert.doesNotMatch(toolbar, /isResetting \? <LoaderCircle className="animate-spin" \/> : <X \/>\}\s*\n\s*Reset\s*\n/);
  assert.match(toolbar, /\{isResetting \? <LoaderCircle className="animate-spin" \/> : <X \/>\}\s*\n\s*<\/Button>/);
});

test('the View popover always lists currently-visible (checked) columns above hidden (unchecked) ones, since the server-driven column list otherwise scatters a column a user just unchecked into the middle of a long list instead of grouping it with the other hidden columns at the bottom', () => {
  assert.match(viewOptions, /\.sort\(\(a, b\) => Number\(b\.getIsVisible\(\)\) - Number\(a\.getIsVisible\(\)\)\);/);
});
