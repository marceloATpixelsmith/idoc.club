'use client';

import type { ColumnDef, ColumnFiltersState, HeaderContext } from '@tanstack/react-table';
import { ClipboardList, Eye, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { persistTablePreferences, TablePreferenceSync } from '@/components/admin/table-preference-sync';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { downloadCsv } from '@/components/admin/download-csv';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
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
  publication?: string;
  updated?: string;
  date?: string;
  payment?: string;
  registrations?: string;
  audience?: string;
};

type ResourceType = 'news' | 'seminars' | 'content_pages';
type ResourceColumn = keyof ResourceRow;
type ResourceConfig = {
  audiences?: { label: string; value: string }[];
  columns: { id: ResourceColumn; label: string }[];
  dateFilter: boolean;
  path: string;
  searchLabel: string;
  statuses: { label: string; value: string }[];
};

const CONFIG: Record<ResourceType, ResourceConfig> = {
  news: {
    columns: [{ id: 'title', label: 'Title' }, { id: 'subtitle', label: 'Subtitle' }, { id: 'slug', label: 'Slug' }, { id: 'status', label: 'Status' }, { id: 'publication', label: 'Publication Date' }, { id: 'updated', label: 'Updated' }],
    dateFilter: true,
    path: '/admin/news',
    searchLabel: 'Search article title, subtitle, or slug',
    statuses: [{ label: 'Draft', value: 'draft' }, { label: 'Scheduled', value: 'scheduled' }, { label: 'Published', value: 'published' }, { label: 'Archived', value: 'archived' }],
  },
  seminars: {
    columns: [{ id: 'title', label: 'Title' }, { id: 'date', label: 'Date' }, { id: 'status', label: 'Status' }, { id: 'payment', label: 'Payment Method' }, { id: 'registrations', label: 'Registered / Capacity' }],
    dateFilter: true,
    path: '/admin/seminars',
    searchLabel: 'Search seminar title or location',
    statuses: [{ label: 'Draft', value: 'draft' }, { label: 'Published', value: 'published' }, { label: 'Canceled', value: 'canceled' }],
  },
  content_pages: {
    audiences: [{ label: 'Public', value: 'public' }, { label: 'Member', value: 'member' }, { label: 'Judge', value: 'judge' }, { label: 'Steward', value: 'steward' }, { label: 'Veterinarian', value: 'veterinarian' }],
    columns: [{ id: 'title', label: 'Title' }, { id: 'slug', label: 'Slug' }, { id: 'status', label: 'Status' }, { id: 'audience', label: 'Audience' }, { id: 'updated', label: 'Updated' }],
    dateFilter: false,
    path: '/admin/pages',
    searchLabel: 'Search page title or slug',
    statuses: [{ label: 'Draft', value: 'draft' }, { label: 'Published', value: 'published' }, { label: 'Archived', value: 'archived' }],
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
  initialColumnOrder, initialFrom, initialSearch, initialSort, initialTo, initialVisibleColumns, page, pageSize, rows, tableType, total,
}: {
  initialColumnOrder?: string;
  initialFrom?: string;
  initialSearch?: string;
  initialSort?: string;
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
        enableSorting: ['title', 'status', 'publication', 'updated', 'date', 'registrations'].includes(id),
        enableColumnFilter: id === 'status' || (tableType === 'content_pages' && id === 'audience'),
        header: header(label),
        meta: id === 'status'
          ? { label, options: config.statuses, variant: 'multiSelect' }
          : id === 'audience'
            ? { label, options: config.audiences ?? [], variant: 'multiSelect' }
            : { label, variant: 'text' },
        cell: ({ row }) => id === 'title'
          ? <Link className="font-medium underline" href={`${config.path}/${row.original.id}`}>{row.original.title}</Link>
          : <span>{row.original[id] ?? '—'}</span>,
      })),
      {
        id: 'actions', enableHiding: false, enableSorting: false, size: 90, header: 'Actions',
        cell: ({ row }) => <div className="flex items-center gap-1">
          <Button asChild aria-label="Edit" size="icon-sm" title="Edit" variant="ghost">
            <Link href={`${config.path}/${row.original.id}`}><Pencil aria-hidden="true" /></Link>
          </Button>
          {tableType !== 'seminars' && <Button asChild aria-label="Preview" size="icon-sm" title="Preview" variant="ghost">
            <Link href={`${config.path}/${row.original.id}/preview`}><Eye aria-hidden="true" /></Link>
          </Button>}
          {tableType === 'seminars' && <Button asChild aria-label="Registrations" size="icon-sm" title="Registrations" variant="ghost">
            <Link href={`${config.path}/${row.original.id}#registrations`}><ClipboardList aria-hidden="true" /></Link>
          </Button>}
        </div>,
      },
    ];
  }, [config, tableType]);
  const defaultSortId = tableType === 'news' ? 'publication' : tableType === 'seminars' ? 'date' : 'updated';
  const initialSorting = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(initialSort || '[]');
      if (Array.isArray(parsed) && parsed.length && config.columns.some(({ id }) => id === parsed[0]?.id)) return parsed;
    } catch { /* fall through to the default below */ }
    return [{ desc: true, id: defaultSortId }];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount.
  }, []);

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
    };
    if (config.dateFilter) { preferences.from = effectiveFrom; preferences.to = effectiveTo; }
    if (tableType === 'content_pages') preferences.audience = filterToken(state.columnFilters, 'audience');
    void persistTablePreferences(tableType, preferences).then((response) => {
      if (!response.ok) setError('Table preferences could not be saved.');
    }).catch(() => setError('Table preferences could not be saved.'));
    startTransition(() => router.refresh());
  }

  const { table } = useDataTable({
    columns, data: rows,
    // Simple (non-advanced) mode is required for the auto-rendered status/audience faceted
    // filters below to sync through `column.setFilterValue` -- advanced mode no-ops that path.
    enableAdvancedFilter: false,
    getRowId: (row) => String(row.id),
    initialState: { columnOrder: initialColumnOrder?.split(','), columnVisibility: initialVisibility, pagination: { pageIndex: page - 1, pageSize }, sorting: initialSorting },
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
    table.resetColumnFilters();
    persistAndRefresh(
      { columnFilters: [], pagination: table.getState().pagination, sorting: table.getState().sorting },
      { from: undefined, to: undefined, q: undefined },
    );
  }

  const debouncedSearchPersist = useDebouncedCallback((value: string) => {
    persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: table.getState().pagination, sorting: table.getState().sorting }, { q: value });
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
    <DataTable table={table} pageSizeOptions={[10, 25, 50, 100]} loading={isPending} emptyState={<div><strong>{filtered ? 'No records match this view' : 'No records yet'}</strong><span className="block text-muted-foreground">{filtered ? 'Change or clear the filters.' : 'Create a record to get started.'}</span></div>} actionBar={<ActionBar open={actionBarVisibility.open} onOpenChange={actionBarVisibility.onOpenChange}><ActionBarSelection>{selected.length} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={() => downloadSelected(selected, config.columns, tableType)}>Export selected CSV</ActionBarItem><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}>
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
            onChange={(event) => { setSearch(event.target.value); debouncedSearchPersist(event.target.value); }}
            placeholder="Search…"
            type="search"
            value={search}
          />
          {config.dateFilter && (
            <DateRangeFilter
              from={from}
              label="Date"
              onChange={(newFrom, newTo) => { setFrom(newFrom); setTo(newTo); persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: table.getState().pagination, sorting: table.getState().sorting }, { from: newFrom, to: newTo }); }}
              onDraftActiveChange={setDateDraftActive}
              resetSignal={dateResetSignal}
              to={to}
            />
          )}
        </>}
      >
        <DataTableSortList table={table} />
      </DataTableToolbar>
      <p aria-live="polite" className="px-1 text-sm text-muted-foreground">{total} matching records</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </DataTable>
  </>;
}
