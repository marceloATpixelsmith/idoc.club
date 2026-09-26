'use client';

import type { ColumnDef, ColumnFiltersState, HeaderContext } from '@tanstack/react-table';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { persistTablePreferences, TablePreferenceSync } from '@/components/admin/table-preference-sync';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection } from '@/components/ui/action-bar';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useActionBarVisibility } from '@/hooks/use-action-bar-visibility';
import { type DataTableLiveState, useDataTable } from '@/hooks/use-data-table';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import { CATEGORY_LABELS, STATUS_LABELS, SUPPORT_CATEGORIES, SUPPORT_STATUSES, type SupportCategory } from '@/lib/support/inbox-options';

type AdminSupportRow = { assignee_name: string; category: SupportCategory; member_email: string; member_name: string; profile_id: number | null; public_id: string; status: string; subject: string; total_count: number; unread: boolean; updated_at: Date; };

const OPTIONAL_COLUMNS = ['member', 'subject', 'category', 'status', 'assigned', 'activity'] as const;
const LABELS: Record<string, string> = { activity: 'Activity', assigned: 'Assigned', category: 'Category', member: 'Member', status: 'Status', subject: 'Subject' };
const CATEGORY_OPTIONS = SUPPORT_CATEGORIES.map((value) => ({ label: CATEGORY_LABELS[value], value }));
const STATUS_OPTIONS = SUPPORT_STATUSES.map((value) => ({ label: STATUS_LABELS[value], value }));
function header(id: string) { return ({ column }: HeaderContext<AdminSupportRow, unknown>) => <DataTableColumnHeader column={column} label={LABELS[id]} />; }
function filterToken(columnFilters: ColumnFiltersState, id: string): string | undefined {
  const value = columnFilters.find((filter) => filter.id === id)?.value;
  const list = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return list.length ? list.join(',') : undefined;
}

export function SupportInboxTable({ administrators, filters, initialColumnOrder, initialVisibleColumns, rows, total }: { administrators: { label: string; value: string }[]; filters: { activityFrom?: string; activityTo?: string; assigned?: string; category?: string; page: number; pageSize: number; q?: string; sort?: string; status?: string }; initialColumnOrder?: string; initialVisibleColumns?: string[]; rows: AdminSupportRow[]; total: number }) {
  const router = useRouter();
  const [search, setSearch] = useState(filters.q ?? '');
  const [activityFrom, setActivityFrom] = useState(filters.activityFrom);
  const [activityTo, setActivityTo] = useState(filters.activityTo);
  const [copyNotice, setCopyNotice] = useState('');
  const [isPending, startTransition] = useTransition();
  const initialVisibility = useMemo(() => {
    if (!initialVisibleColumns) return {};
    return Object.fromEntries(OPTIONAL_COLUMNS.map((column) => [column, initialVisibleColumns.includes(column)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount.
  }, []);
  const columns = useMemo<ColumnDef<AdminSupportRow>[]>(() => [
    { id: 'select', enableHiding: false, enableSorting: false, size: 40, header: ({ table }) => <Checkbox aria-label="Select all support conversations on this page" checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')} onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))} />, cell: ({ row }) => <Checkbox aria-label={`Select ${row.original.subject}`} checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(Boolean(value))} /> },
    { id: 'member', accessorFn: (row) => `${row.member_name} ${row.member_email}`, header: header('member'), meta: { label: 'Member' }, cell: ({ row }) => <div>{row.original.profile_id ? <Link className="font-medium underline" href={`/admin/members?profileId=${row.original.profile_id}`}>{row.original.member_name || 'Member record'}</Link> : row.original.member_name}<span className="block text-sm text-muted-foreground">{row.original.member_email}</span></div> },
    { id: 'subject', accessorKey: 'subject', header: header('subject'), meta: { label: 'Subject' }, cell: ({ row }) => <Link className="font-medium underline" href={`/admin/support/${row.original.public_id}?returnTo=${encodeURIComponent('/admin/support')}`}>{row.original.subject}{row.original.unread ? ' · New' : ''}</Link> },
    { id: 'category', accessorKey: 'category', enableColumnFilter: true, header: header('category'), meta: { label: 'Category', options: CATEGORY_OPTIONS, variant: 'multiSelect' }, cell: ({ row }) => CATEGORY_LABELS[row.original.category] },
    { id: 'status', accessorKey: 'status', enableColumnFilter: true, header: header('status'), meta: { label: 'Status', options: STATUS_OPTIONS, variant: 'multiSelect' }, cell: ({ row }) => STATUS_LABELS[row.original.status] },
    { id: 'assigned', accessorKey: 'assignee_name', enableColumnFilter: true, header: header('assigned'), meta: { label: 'Assigned Administrator', options: [{ label: 'Unassigned', value: 'unassigned' }, ...administrators], variant: 'multiSelect' }, cell: ({ row }) => row.original.assignee_name || 'Unassigned' },
    { id: 'activity', accessorKey: 'updated_at', header: header('activity'), meta: { label: 'Activity Date' }, cell: ({ row }) => new Date(row.original.updated_at).toLocaleString() },
  ], [administrators]);
  const initialSorting = useMemo(() => {
    try { const parsed = JSON.parse(filters.sort ?? '[]'); if (Array.isArray(parsed) && parsed.length) return parsed; } catch { /* fall through to the default below */ }
    return [{ desc: true, id: 'activity' as keyof AdminSupportRow }];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount.
  }, []);
  // Facet filters are applied server-side from saved preferences regardless of this initial
  // state, so this must mirror what the server actually applied -- otherwise the toolbar shows no
  // active facets while the table is already filtered, and the next unrelated change persists
  // `undefined` for these, silently clearing the saved view.
  const initialColumnFilters = useMemo(() => [
    { id: 'category', value: filters.category ? filters.category.split(',') : [] },
    { id: 'status', value: filters.status ? filters.status.split(',') : [] },
    { id: 'assigned', value: filters.assigned ? filters.assigned.split(',') : [] },
  ].filter((filter) => filter.value.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount.
    []);

  // Persists to the database and refetches via a same-URL router.refresh() -- deliberately never
  // writes any of this to the URL. `overrides` lets Reset atomically change search/date-range
  // alongside table state without racing separate persist calls against each other.
  function persistAndRefresh(state: DataTableLiveState, overrides?: { activityFrom?: string; activityTo?: string; q?: string }) {
    const effectiveSearch = overrides && 'q' in overrides ? overrides.q : search;
    const effectiveFrom = overrides && 'activityFrom' in overrides ? overrides.activityFrom : activityFrom;
    const effectiveTo = overrides && 'activityTo' in overrides ? overrides.activityTo : activityTo;
    void persistTablePreferences('support', {
      activityFrom: effectiveFrom,
      activityTo: effectiveTo,
      assigned: filterToken(state.columnFilters, 'assigned'),
      category: filterToken(state.columnFilters, 'category'),
      columnOrder: table.getState().columnOrder.join(','),
      columns: OPTIONAL_COLUMNS.filter((column) => table.getState().columnVisibility[column] !== false),
      page: state.pagination.pageIndex + 1,
      pageSize: state.pagination.pageSize,
      q: effectiveSearch || undefined,
      sort: state.sorting.length ? JSON.stringify(state.sorting) : undefined,
      status: filterToken(state.columnFilters, 'status'),
    }).finally(() => startTransition(() => router.refresh()));
  }

  const { table } = useDataTable({
    columns, data: rows,
    // Simple (non-advanced) mode is required for the auto-rendered category/status/assigned
    // faceted filters below to sync through `column.setFilterValue` -- advanced mode no-ops that path.
    enableAdvancedFilter: false,
    getRowId: (row) => row.public_id,
    initialState: { columnFilters: initialColumnFilters, columnOrder: initialColumnOrder?.split(','), columnVisibility: initialVisibility, pagination: { pageIndex: filters.page - 1, pageSize: filters.pageSize }, sorting: initialSorting },
    onLiveStateChange: (state) => persistAndRefresh(state),
    pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
    startTransition,
  });

  const skipNextColumnPersist = useRef(true);
  const visibilityKey = JSON.stringify(table.getState().columnVisibility);
  const orderKey = table.getState().columnOrder.join(',');
  useEffect(() => {
    if (skipNextColumnPersist.current) { skipNextColumnPersist.current = false; return; }
    persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: table.getState().pagination, sorting: table.getState().sorting });
    table.resetRowSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires exactly when visibility/order change, reading everything else fresh at call time.
  }, [visibilityKey, orderKey]);

  function resetAll() {
    setSearch('');
    setActivityFrom(undefined);
    setActivityTo(undefined);
    setDateResetSignal((signal) => signal + 1);
    table.resetColumnFilters();
    persistAndRefresh(
      { columnFilters: [], pagination: table.getState().pagination, sorting: table.getState().sorting },
      { activityFrom: undefined, activityTo: undefined, q: undefined },
    );
  }

  // A manual filter change (search, date range) must return to page 1 -- otherwise staying on
  // page N of a now-narrower result set can show an empty table, or even "Page N of 1".
  const debouncedSearchPersist = useDebouncedCallback((value: string) => {
    persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: { ...table.getState().pagination, pageIndex: 0 }, sorting: table.getState().sorting }, { q: value });
  }, 300);

  async function copySelectedLinks() {
    try {
      await navigator.clipboard.writeText(table.getSelectedRowModel().rows.map(({ original }) => `${window.location.origin}/admin/support/${original.public_id}`).join('\n'));
      setCopyNotice('Selected links copied.');
    } catch { setCopyNotice('Could not copy the selected links.'); }
  }
  const selected = table.getSelectedRowModel().rows.length;
  const actionBarVisibility = useActionBarVisibility(selected);
  // `manuallyFiltered` drives the Reset button's visibility, so it deliberately excludes `q`
  // (search) -- the search box has its own clear affordance. `filtered` drives the empty-state
  // copy, so it must include `q`: a search that matches nothing is still "no conversations match
  // this view", not "no support conversations exist at all".
  const [dateDraftActive, setDateDraftActive] = useState(false);
  const [dateResetSignal, setDateResetSignal] = useState(0);
  const manuallyFiltered = Boolean(activityFrom || activityTo) || dateDraftActive;
  const filtered = manuallyFiltered || Boolean(search) || table.getState().columnFilters.length > 0;
  return <><TablePreferenceSync table="support" /><DataTable actionBar={<ActionBar onOpenChange={actionBarVisibility.onOpenChange} open={actionBarVisibility.open}><ActionBarSelection>{selected} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={() => void copySelectedLinks()}>Copy selected links</ActionBarItem><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>} emptyState={<div><strong>{filtered ? 'No conversations match this view' : 'No support conversations exist'}</strong><span className="mt-1 block text-muted-foreground">{filtered ? 'Edit or clear filters to broaden the queue.' : 'New member conversations will appear here.'}</span></div>} loading={isPending} pageSizeOptions={[10, 25, 50, 100]} table={table}>
    <DataTableToolbar
      className="rounded-xl border bg-background p-3"
      table={table}
      isFiltered={manuallyFiltered}
      pending={isPending}
      onReset={resetAll}
      leading={<>
        <Input aria-label="Search support conversations" className="h-8 w-40 lg:w-56" onChange={(event) => { setSearch(event.target.value); table.setPageIndex(0); debouncedSearchPersist(event.target.value); }} placeholder="Search member, email, or subject…" type="search" value={search} />
        <DateRangeFilter from={activityFrom} label="Activity" onChange={(nextFrom, nextTo) => { setActivityFrom(nextFrom); setActivityTo(nextTo); table.setPageIndex(0); persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: { ...table.getState().pagination, pageIndex: 0 }, sorting: table.getState().sorting }, { activityFrom: nextFrom, activityTo: nextTo }); }} onDraftActiveChange={setDateDraftActive} resetSignal={dateResetSignal} to={activityTo} />
      </>}
    >
      <DataTableSortList table={table} />
    </DataTableToolbar>
    <p aria-live="polite" className="px-1 text-sm text-muted-foreground">{total} matching conversations</p>{copyNotice && <p aria-live="polite" className="px-1 text-sm">{copyNotice}</p>}</DataTable></>;
}
