'use client';

import type { ColumnDef, HeaderContext, VisibilityState } from '@tanstack/react-table';
import { ClipboardList, Eye, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import { useDataTable } from '@/hooks/use-data-table';
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

export function ResourceDataTable({
  initialVisibleColumns, page, pageSize, rows, tableType, total,
}: {
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
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [error, setError] = useState('');
  const suppressPersistence = useRef(false);
  const syncingUrl = useRef(false);
  const [isPending, startTransition] = useTransition();
  const optional = useMemo(() => config.columns.filter(({ id }) => id !== 'title').map(({ id }) => id), [config]);
  const initialVisibility = useMemo<VisibilityState>(() => {
    const explicit = searchParams.getAll('column');
    const selected = explicit.length ? explicit : initialVisibleColumns;
    return selected ? Object.fromEntries(optional.map((id) => [id, selected.includes(id)])) : {};
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
  const initialSorting = useMemo(() => {
    const value = searchParams.get('sort') ?? '';
    try
      {
      const parsed: unknown = JSON.parse(value || '[]');
      if (Array.isArray(parsed) && parsed.length && config.columns.some(({ id }) => id === parsed[0]?.id))
        {
        return parsed;
        }
      }
    catch
      {
      }
    const legacy = ['title', 'status', 'publication', 'updated', 'date', 'registrations'].includes(value)
      && config.columns.some(({ id }) => id === value) ? value : '';
    return [{ desc: searchParams.get('direction') !== 'asc', id: legacy || (tableType === 'news' ? 'publication' : tableType === 'seminars' ? 'date' : 'updated') }];
  }, []);
  const { table } = useDataTable({
    columns, data: rows,
    // Simple (non-advanced) mode is required for the auto-rendered status/audience faceted
    // filters below to sync through `column.setFilterValue` -- advanced mode no-ops that path.
    enableAdvancedFilter: false,
    getRowId: (row) => String(row.id),
    initialState: { columnVisibility: initialVisibility, pagination: { pageIndex: page - 1, pageSize }, sorting: initialSorting },
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    queryKeys: { page: 'page', perPage: 'pageSize', sort: 'sort' },
    shallow: false,
    startTransition,
  });

  useEffect(() => setSearch(searchParams.get('q') ?? ''), [searchParams]);
  useEffect(() => { table.resetRowSelection(); }, [searchParams, table]);
  const urlColumns = searchParams.getAll('column').join('\u0000');
  useEffect(() => {
    const selected = searchParams.getAll('column');
    const next = Object.fromEntries(optional.map((id) => [id, !selected.length || selected.includes(id)]));
    const current = table.getState().columnVisibility;
    if (optional.some((id) => current[id] !== next[id]))
      {
      syncingUrl.current = true;
      table.setColumnVisibility(next);
      }
  }, [urlColumns]);
  useEffect(() => {
    if (suppressPersistence.current) return;
    if (syncingUrl.current)
      {
      syncingUrl.current = false;
      return;
      }
    const state = table.getState();
    const selected = optional.filter((id) => state.columnVisibility[id] !== false);
    const current = searchParams.getAll('column');
    if (current.length === selected.length && current.every((value, index) => value === selected[index])) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('column');
    if (!selected.length) params.append('column', '');
    else for (const id of selected) params.append('column', id);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [table.getState().columnVisibility]);
  useEffect(() => {
    if (suppressPersistence.current) return;
    const params = new URLSearchParams(searchParams.toString());
    const preferences: TablePreferenceState = {
      columns: optional.filter((id) => table.getState().columnVisibility[id] !== false),
      columnOrder: params.get('columnOrder') ?? undefined,
      direction: params.get('direction') ?? undefined,
      pageSize: Number(params.get('pageSize') ?? pageSize),
      q: params.get('q') ?? undefined,
      sort: params.get('sort') ?? undefined,
      status: params.get('status') ?? undefined,
    };
    if (config.dateFilter)
      {
      preferences.from = params.get('from') ?? undefined;
      preferences.to = params.get('to') ?? undefined;
      }
    if (tableType === 'content_pages') preferences.audience = params.get('audience') ?? undefined;
    void persistTablePreferences(tableType, preferences).then((response) => {
      if (!response.ok) setError('Table preferences could not be saved.');
    }).catch(() => setError('Table preferences could not be saved.'));
  }, [config.dateFilter, optional, pageSize, searchParams, table, tableType, table.getState().columnVisibility]);

  function update(values: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    // Purge the retired advanced filter-builder's params so a stale/shared URL carrying them
    // doesn't keep silently narrowing results the current toolbar shows no indication of.
    params.delete('filters');
    params.delete('joinOperator');
    for (const [key, value] of Object.entries(values))
      {
      if (value) params.set(key, value);
      else params.delete(key);
      }
    params.delete('page');
    startTransition(() => router.push(`${pathname}?${params}`));
  }
  const debouncedSearch = useDebouncedCallback((value: string) => update({ q: value || undefined }), 300);
  const selected = table.getSelectedRowModel().rows.map((row) => row.original);
  const actionBarVisibility = useActionBarVisibility(selected.length);
  // `manuallyFiltered` drives the Reset button's visibility, so it deliberately excludes `q`
  // (search) -- the search box has its own clear affordance. `filtered` drives the empty-state
  // copy, so it must include `q`: a search that matches nothing is still "no records match this
  // view", not "no records exist at all".
  const manuallyFiltered = ['from', 'to'].some((key) => searchParams.has(key));
  const filtered = manuallyFiltered || searchParams.has('q') || searchParams.has('status') || searchParams.has('audience');
  return <>
    <TablePreferenceSync table={tableType as AdminTableIdentifier} />
    <DataTable table={table} pageSizeOptions={[10, 25, 50, 100]} loading={isPending} emptyState={<div><strong>{filtered ? 'No records match this view' : 'No records yet'}</strong><span className="block text-muted-foreground">{filtered ? 'Change or clear the filters.' : 'Create a record to get started.'}</span></div>} actionBar={<ActionBar open={actionBarVisibility.open} onOpenChange={actionBarVisibility.onOpenChange}><ActionBarSelection>{selected.length} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={() => downloadSelected(selected, config.columns, tableType)}>Export selected CSV</ActionBarItem><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}>
      <DataTableToolbar
        className="mt-5 rounded-xl border bg-background p-3"
        table={table}
        isFiltered={manuallyFiltered}
        onReset={() => update({ q: undefined, from: undefined, to: undefined })}
        leading={<>
          <Input
            aria-label={config.searchLabel}
            className="h-8 w-40 lg:w-56"
            onChange={(event) => { setSearch(event.target.value); debouncedSearch(event.target.value); }}
            placeholder="Search…"
            type="search"
            value={search}
          />
          {config.dateFilter && (
            <DateRangeFilter
              from={searchParams.get('from') ?? undefined}
              label="Date"
              onChange={(from, to) => update({ from, to })}
              to={searchParams.get('to') ?? undefined}
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
