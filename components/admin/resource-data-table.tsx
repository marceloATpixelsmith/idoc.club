'use client';

import type { ColumnDef, ColumnFiltersState, HeaderContext } from '@tanstack/react-table';
import { Archive, BookOpenText, CircleAlert, CircleCheck, CircleDashed, ClipboardList, Clock3, Download, Newspaper, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { BulkDeleteSelected } from '@/components/admin/bulk-delete-selected';
import { BulkNewsStatusSelected } from '@/components/admin/bulk-update-selected';
import { persistTablePreferences, TablePreferenceSync } from '@/components/admin/table-preference-sync';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { downloadCsv } from '@/components/admin/download-csv';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableActionsRow } from '@/components/data-table/data-table-actions-row';
import { DataTableColumnHeader, DataTableStaticHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection } from '@/components/ui/action-bar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useActionBarVisibility } from '@/hooks/use-action-bar-visibility';
import { type DataTableLiveState, useDataTable } from '@/hooks/use-data-table';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import type { AdminTableIdentifier, TablePreferenceState } from '@/lib/admin/table-preferences';

export type ResourceRow = {
  id: number;
  title: string;
  status: string;
  subtitle?: string;
  slug?: string;
  type?: string;
  thumbnailUrl?: string;
  publication?: string;
  updated?: string;
  date?: string;
  start?: string;
  end?: string;
  deadline?: string;
  prices?: string;
  registrations?: string;
};

type ResourceType = 'news' | 'seminars';
type ResourceColumn = keyof ResourceRow;
type ResourceConfig = {
  columns: { id: ResourceColumn; label: string }[];
  dateFilter: boolean;
  path: string;
  searchLabel: string;
  statuses: { label: string; value: string }[];
  types?: { label: string; value: string }[];
};

const CONFIG: Record<ResourceType, ResourceConfig> = {
  news: {
    columns: [{ id: 'title', label: 'Title' }, { id: 'type', label: 'Type' }, { id: 'status', label: 'Status' }, { id: 'publication', label: 'Publication Date' }, { id: 'subtitle', label: 'Subtitle' }, { id: 'updated', label: 'Updated' }],
    dateFilter: true,
    path: '/admin/news',
    searchLabel: 'Search article title, subtitle, or slug',
    statuses: [{ label: 'Draft', value: 'draft' }, { label: 'Scheduled', value: 'scheduled' }, { label: 'Published', value: 'published' }, { label: 'Archived', value: 'archived' }],
    types: [{ label: 'NEWS', value: 'news' }, { label: 'BLOG', value: 'blog' }],
  },
  seminars: {
    columns: [{ id: 'title', label: 'Title' }, { id: 'status', label: 'Status' }, { id: 'start', label: 'Start' }, { id: 'end', label: 'End' }, { id: 'deadline', label: 'Deadline' }, { id: 'prices', label: 'Prices' }, { id: 'registrations', label: 'Registered / Capacity' }],
    dateFilter: true,
    path: '/admin/seminars',
    searchLabel: 'Search seminar title or location',
    statuses: [{ label: 'Draft', value: 'draft' }, { label: 'Published', value: 'published' }, { label: 'Canceled', value: 'canceled' }],
  },
};

function downloadSelected(rows: ResourceRow[], columns: ResourceConfig['columns'], type: ResourceType) {
  downloadCsv(
    `${type}-selected.csv`,
    columns.map((column) => column.label),
    rows.map((row) => columns.map((column) => String(row[column.id] ?? ''))),
  );
}

function filterToken(columnFilters: ColumnFiltersState, id: string): string | undefined {
  const value = columnFilters.find((filter) => filter.id === id)?.value;
  const list = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return list.length ? list.join(',') : undefined;
}

export function ResourceDataTable({
  initialColumnOrder, initialFrom, initialSearch, initialSort, initialStatus, initialType, initialTo, initialVisibleColumns, page, pageSize, rows, tableType, total,
}: {
  initialColumnOrder?: string;
  initialFrom?: string;
  initialSearch?: string;
  initialSort?: string;
  initialStatus?: string;
  initialType?: string;
  initialTo?: string;
  initialVisibleColumns?: string[];
  page: number;
  pageSize: number;
  rows: ResourceRow[];
  tableType: ResourceType;
  total: number;
}) {
  const config = CONFIG[tableType];
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch ?? '');
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const openTableAction = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    startTransition(() => router.push(href));
  }, [router]);
  const optional = useMemo(() => config.columns.filter(({ id }) => id !== 'title').map(({ id }) => id), [config]);
  const initialVisibility = useMemo(() => {
    if (!initialVisibleColumns) return {};
    return Object.fromEntries(optional.map((id) => [id, initialVisibleColumns.includes(id)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount, matching useDataTable's own initialState-is-only-read-once contract.
  }, []);
  const columns = useMemo<ColumnDef<ResourceRow>[]>(() => {
    const header = (label: string) => ({ column }: HeaderContext<ResourceRow, unknown>) => <DataTableColumnHeader column={column} label={label} />;
    return [
      {
        id: 'select', enableHiding: false, enableSorting: false, size: 40,
        header: ({ table }) => <Checkbox aria-label="Select all rows on this page" checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')} onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))} />,
        cell: ({ row }) => <Checkbox aria-label={`Select ${row.original.title}`} checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(Boolean(value))} />,
      },
      ...config.columns.map(({ id, label }): ColumnDef<ResourceRow> => ({
        id,
        accessorFn: (row) => row[id] ?? '',
        enableHiding: id !== 'title',
        enableSorting: ['title', 'type', 'status', 'publication', 'updated', 'date', 'start', 'end', 'deadline', 'registrations'].includes(id),
        enableColumnFilter: id === 'status' || (tableType === 'news' && id === 'type'),
        header: header(label),
        meta: id === 'status'
          ? { label, options: config.statuses, variant: 'multiSelect' }
          : id === 'type' && tableType === 'news'
            ? { label, options: config.types ?? [], variant: 'multiSelect' }
            : { label, variant: 'text' },
        cell: ({ row }) => id === 'title'
          ? tableType === 'news'
            ? <span><span className="block font-medium">{row.original.title}</span><span className="block text-sm text-muted-foreground">{row.original.slug}</span></span>
            : <span className="font-medium">{row.original.title}</span>
          : id === 'status' && tableType === 'seminars'
            ? (() => { const Icon = row.original.status === 'published' ? CircleCheck : row.original.status === 'canceled' ? CircleAlert : CircleDashed; return <span className="inline-flex items-center gap-2 font-medium"><Icon aria-hidden className="size-4" />{row.original.status.toUpperCase()}</span>; })()
            : id === 'status' && tableType === 'news'
              ? (() => { const Icon = row.original.status === 'published' ? CircleCheck : row.original.status === 'scheduled' ? Clock3 : row.original.status === 'archived' ? Archive : CircleDashed; return <span className="inline-flex items-center gap-2 font-medium"><Icon aria-hidden className="size-4" />{row.original.status.toUpperCase()}</span>; })()
              : id === 'type' && tableType === 'news'
                ? (() => { const Icon = row.original.type === 'blog' ? BookOpenText : Newspaper; return <span className="inline-flex items-center gap-2 font-medium"><Icon aria-hidden className="size-4" />{String(row.original.type ?? 'news').toUpperCase()}</span>; })()
                : <span>{row.original[id] ?? '—'}</span>,
      })),
      {
        id: 'actions', enableHiding: false, enableSorting: false, meta: { label: 'Actions' }, size: 90,
        // Matches DataTableColumnHeader's own look (a native button, so the sitewide
        // uppercase/bold/letter-spacing rule already applies) instead of a bespoke size/weight,
        // only tinting it gold -- the same treatment as every other Actions column. Non-hideable:
        // this column has no accessorFn, so it never appears in the View popover to be restored.
        header: () => <DataTableStaticHeader className="text-gold" label="Actions" />,
        cell: ({ row }) => <div className="flex items-center gap-1">
          <Button asChild aria-label="Edit" size="icon-sm" title="Edit" variant="ghost">
            <Link
              href={tableType === 'news' ? `/admin/news?articleId=${row.original.id}` : tableType === 'seminars' ? `/admin/seminars?seminarId=${row.original.id}` : `${config.path}/${row.original.id}`}
              onClick={(event) => {
                const href = tableType === 'news' ? `/admin/news?articleId=${row.original.id}` : tableType === 'seminars' ? `/admin/seminars?seminarId=${row.original.id}` : `${config.path}/${row.original.id}`;
                openTableAction(event, href);
              }}
            ><Pencil aria-hidden="true" /></Link>
          </Button>
          {tableType === 'seminars' && <>
            <Button asChild aria-label="Registrations" size="icon-sm" title="View registrations" variant="ghost">
              <Link href={`/admin/seminars/registrations?seminarId=${row.original.id}`} onClick={(event) => openTableAction(event, `/admin/seminars/registrations?seminarId=${row.original.id}`)}><ClipboardList aria-hidden="true" /></Link>
            </Button>
            <Button asChild aria-label="Download registrations" size="icon-sm" title="Download this seminar's registrations" variant="ghost">
              <a download href={`/api/admin/export/seminar-registrations?seminarId=${row.original.id}`}><Download aria-hidden="true" /></a>
            </Button>
          </>}
        </div>,
      },
    ];
  }, [config, openTableAction, tableType]);
  const defaultColumnOrder = tableType === 'seminars'
    ? ['select', 'title', 'status', 'prices', 'start', 'end', 'deadline', 'registrations', 'actions']
    : tableType === 'news'
      ? ['select', 'title', 'type', 'status', 'publication', 'subtitle', 'updated', 'actions']
      : ['select', ...config.columns.map(({ id }) => id), 'actions'];
  const defaultSortId = tableType === 'news' ? 'publication' : tableType === 'seminars' ? 'start' : 'updated';
  const initialSorting = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(initialSort || '[]');
      if (Array.isArray(parsed) && parsed.length && config.columns.some(({ id }) => id === parsed[0]?.id)) return parsed;
    } catch { /* fall through to the default below */ }
    return [{ desc: true, id: defaultSortId }];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount.
  }, []);
  // Facet filters are applied server-side from saved preferences regardless of this initial
  // state, so this must mirror what the server actually applied -- otherwise the toolbar shows no
  // active facets while the table is already filtered, and the next unrelated change persists
  // `undefined` for these, silently clearing the saved view.
  const initialColumnFilters = useMemo(() => [
    { id: 'status', value: initialStatus ? initialStatus.split(',') : [] },
    { id: 'type', value: initialType ? initialType.split(',') : [] },
  ].filter((filter) => filter.value.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount.
    []);

  // Persists to the database and refetches via a same-URL router.refresh() -- deliberately never
  // writes any of this to the URL. `overrides` lets Reset atomically change search/date-range
  // alongside table state without racing separate persist calls against each other.
  function persistAndRefresh(state: DataTableLiveState, overrides?: { from?: string; to?: string; q?: string }) {
    const effectiveSearch = overrides && 'q' in overrides ? overrides.q : search;
    const effectiveFrom = overrides && 'from' in overrides ? overrides.from : from;
    const effectiveTo = overrides && 'to' in overrides ? overrides.to : to;
    const preferences: TablePreferenceState = {
      columnOrder: table.getState().columnOrder.join(','),
      columns: optional.filter((id) => table.getState().columnVisibility[id] !== false),
      page: state.pagination.pageIndex + 1,
      pageSize: state.pagination.pageSize,
      q: effectiveSearch || undefined,
      sort: state.sorting.length ? JSON.stringify(state.sorting) : undefined,
      status: filterToken(state.columnFilters, 'status'),
      type: tableType === 'news' ? filterToken(state.columnFilters, 'type') : undefined,
    };
    if (config.dateFilter) { preferences.from = effectiveFrom; preferences.to = effectiveTo; }
    void persistTablePreferences(tableType, preferences).then((response) => {
      if (!response.ok) setError('Table preferences could not be saved.');
    }).catch(() => setError('Table preferences could not be saved.')).finally(() => startTransition(() => router.refresh()));
  }

  const { table } = useDataTable({
    columns, data: rows,
    // Simple (non-advanced) mode is required for the auto-rendered status/audience faceted
    // filters below to sync through `column.setFilterValue` -- advanced mode no-ops that path.
    enableAdvancedFilter: false,
    getRowId: (row) => String(row.id),
    initialState: { columnFilters: initialColumnFilters, columnOrder: initialColumnOrder?.split(',') ?? defaultColumnOrder, columnVisibility: initialVisibility, pagination: { pageIndex: page - 1, pageSize }, sorting: initialSorting },
    onLiveStateChange: (state) => persistAndRefresh(state),
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
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
    setFrom(undefined);
    setTo(undefined);
    setDateResetSignal((signal) => signal + 1);
    // `true` forces a blank reset ([]) -- omitting it resets to `initialState.columnFilters`, which
    // is non-empty whenever a facet was already applied when this table mounted.
    table.resetColumnFilters(true);
    persistAndRefresh(
      { columnFilters: [], pagination: table.getState().pagination, sorting: table.getState().sorting },
      { from: undefined, to: undefined, q: undefined },
    );
  }

  // A manual filter change (search, date range) must return to page 1 -- otherwise staying on
  // page N of a now-narrower result set can show an empty table, or even "Page N of 1".
  const debouncedSearchPersist = useDebouncedCallback((value: string) => {
    persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: { ...table.getState().pagination, pageIndex: 0 }, sorting: table.getState().sorting }, { q: value });
  }, 300);

  const selected = table.getSelectedRowModel().rows.map((row) => row.original);
  const actionBarVisibility = useActionBarVisibility(selected.length);
  // `manuallyFiltered` drives the Reset button's visibility, so it deliberately excludes `q`
  // (search) -- the search box has its own clear affordance. `filtered` drives the empty-state
  // copy, so it must include `q`: a search that matches nothing is still "no records match this
  // view", not "no records exist at all".
  const [dateDraftActive, setDateDraftActive] = useState(false);
  const [dateResetSignal, setDateResetSignal] = useState(0);
  const manuallyFiltered = Boolean(from || to) || dateDraftActive;
  const filtered = manuallyFiltered || Boolean(search) || table.getState().columnFilters.length > 0;
  return <>
    <TablePreferenceSync table={tableType as AdminTableIdentifier} />
    <DataTable table={table} pageSizeOptions={[10, 25, 50, 100]} loading={isPending} emptyState={<div><strong>{filtered ? 'No records match this view' : 'No records yet'}</strong><span className="block text-muted-foreground">{filtered ? 'Change or clear the filters.' : 'Create a record to get started.'}</span></div>} actionBar={<ActionBar open={actionBarVisibility.open} onOpenChange={actionBarVisibility.onOpenChange}><ActionBarSelection>{selected.length} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={() => downloadSelected(selected, config.columns, tableType)}>Export selected CSV</ActionBarItem>{tableType === 'news' ? <BulkNewsStatusSelected clearSelection={() => table.resetRowSelection()} ids={selected.map((row) => String(row.id))} /> : null}<BulkDeleteSelected clearSelection={() => table.resetRowSelection()} ids={selected.map((row) => String(row.id))} table={tableType} /><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}>
      <DataTableToolbar
        className="mt-5 rounded-xl border bg-background p-3"
        table={table}
        isFiltered={manuallyFiltered}
        pending={isPending}
        onReset={resetAll}
        leading={<>
          <Input
            aria-label={config.searchLabel}
            className="h-8 w-40 lg:w-56"
            onChange={(event) => { setSearch(event.target.value); table.setPageIndex(0); debouncedSearchPersist(event.target.value); }}
            placeholder="Search…"
            type="search"
            value={search}
          />
          {config.dateFilter && (
            <DateRangeFilter
              from={from}
              label="Date"
              onChange={(newFrom, newTo) => { setFrom(newFrom); setTo(newTo); table.setPageIndex(0); persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: { ...table.getState().pagination, pageIndex: 0 }, sorting: table.getState().sorting }, { from: newFrom, to: newTo }); }}
              onDraftActiveChange={setDateDraftActive}
              resetSignal={dateResetSignal}
              to={to}
            />
          )}
        </>}
      />
      <DataTableActionsRow count={`${total} matching records`} table={table}>
        <DataTableSortList table={table} />
      </DataTableActionsRow>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </DataTable>
  </>;
}
