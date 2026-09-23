'use client';

import type { ColumnDef, HeaderContext, VisibilityState } from '@tanstack/react-table';
import { X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { persistTablePreferences, TablePreferenceSync } from '@/components/admin/table-preference-sync';
import { downloadCsv } from '@/components/admin/download-csv';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableAdvancedToolbar } from '@/components/data-table/data-table-advanced-toolbar';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableFilterList } from '@/components/data-table/data-table-filter-list';
import { DataTableFilterMenu } from '@/components/data-table/data-table-filter-menu';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection } from '@/components/ui/action-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDataTable } from '@/hooks/use-data-table';
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
  columns: { id: ResourceColumn; label: string }[];
  dateFilter: boolean;
  path: string;
  searchLabel: string;
  statuses: { label: string; value: string }[];
};

const CONFIG: Record<ResourceType, ResourceConfig> = {
  news: {
    columns: [{ id: 'title', label: 'Title' }, { id: 'subtitle', label: 'Subtitle' }, { id: 'slug', label: 'Slug' }, { id: 'status', label: 'Status' }, { id: 'publication', label: 'Publication date' }, { id: 'updated', label: 'Updated' }],
    dateFilter: true,
    path: '/admin/news',
    searchLabel: 'Search article title, subtitle, or slug',
    statuses: [{ label: 'Draft', value: 'draft' }, { label: 'Scheduled', value: 'scheduled' }, { label: 'Published', value: 'published' }, { label: 'Archived', value: 'archived' }],
  },
  seminars: {
    columns: [{ id: 'title', label: 'Title' }, { id: 'date', label: 'Date' }, { id: 'status', label: 'Status' }, { id: 'payment', label: 'Payment method' }, { id: 'registrations', label: 'Registered / capacity' }],
    dateFilter: true,
    path: '/admin/seminars',
    searchLabel: 'Search seminar title or location',
    statuses: [{ label: 'Draft', value: 'draft' }, { label: 'Published', value: 'published' }, { label: 'Canceled', value: 'canceled' }],
  },
  content_pages: {
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
  const advancedFilterKey = `${searchParams.get('filters') ?? ''}\u0000${searchParams.get('joinOperator') ?? ''}`;
  const previousAdvancedFilter = useRef(advancedFilterKey);
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
        id: 'select', enableHiding: false, enableSorting: false,
        header: ({ table }) => <input aria-label="Select all rows on this page" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} type="checkbox" />,
        cell: ({ row }) => <input aria-label={`Select ${row.original.title}`} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} type="checkbox" />,
      },
      ...config.columns.map(({ id, label }): ColumnDef<ResourceRow> => ({
        id,
        accessorFn: (row) => row[id] ?? '',
        enableSorting: ['title', 'status', 'publication', 'updated', 'date', 'registrations'].includes(id),
        enableColumnFilter: id === 'title' || id === 'status',
        header: header(label),
        meta: id === 'status'
          ? { label, options: config.statuses, variant: 'multiSelect' }
          : { label, variant: 'text' },
        cell: ({ row }) => id === 'title'
          ? <Link className="font-medium underline" href={`${config.path}/${row.original.id}`}>{row.original.title}</Link>
          : <span>{row.original[id] ?? '—'}</span>,
      })),
      {
        id: 'actions', enableHiding: false, enableSorting: false, header: 'Actions',
        cell: ({ row }) => <div className="flex gap-3 whitespace-nowrap">
          <Link className="underline" href={`${config.path}/${row.original.id}`}>Edit</Link>
          {tableType !== 'seminars' && <Link className="underline" href={`${config.path}/${row.original.id}/preview`}>Preview</Link>}
          {tableType === 'seminars' && <Link className="underline" href={`${config.path}/${row.original.id}#registrations`}>Registrations</Link>}
        </div>,
      },
    ];
  }, [config, tableType]);
  const initialSorting = useMemo(() => {
    try
      {
      const parsed: unknown = JSON.parse(searchParams.get('sort') ?? '[]');
      if (Array.isArray(parsed) && parsed.length && config.columns.some(({ id }) => id === parsed[0]?.id))
        {
        return parsed;
        }
      }
    catch
      {
      }
    return [{ desc: true, id: tableType === 'news' ? 'publication' : tableType === 'seminars' ? 'date' : 'updated' }];
  }, []);
  const { table, debounceMs, shallow, throttleMs } = useDataTable({
    columns, data: rows, enableAdvancedFilter: true, getRowId: (row) => String(row.id),
    initialState: { columnVisibility: initialVisibility, pagination: { pageIndex: page - 1, pageSize }, sorting: initialSorting },
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    queryKeys: { filters: 'filters', joinOperator: 'joinOperator', page: 'page', perPage: 'pageSize', sort: 'sort' },
    shallow: false,
  });

  useEffect(() => setSearch(searchParams.get('q') ?? ''), [searchParams]);
  useEffect(() => { table.resetRowSelection(); }, [searchParams, table]);
  useEffect(() => {
    if (previousAdvancedFilter.current === advancedFilterKey) return;
    previousAdvancedFilter.current = advancedFilterKey;
    if (!searchParams.has('page')) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('page');
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [advancedFilterKey]);
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
      direction: params.get('direction') ?? undefined,
      filters: params.get('filters') ?? undefined,
      joinOperator: params.get('joinOperator') ?? undefined,
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

  function update(values: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(values))
      {
      if (value) params.set(key, value);
      else params.delete(key);
      }
    params.delete('page');
    router.push(`${pathname}?${params}`);
  }
  async function reset() {
    const response = await fetch(`/api/admin/table-preferences/${tableType}`, {
      credentials: 'same-origin',
      headers: { 'x-idoc-csrf': decodeURIComponent(document.cookie.match(/(?:^|; )(?:__Host-)?idoc-csrf=([^;]+)/)?.[1] ?? '') },
      method: 'DELETE',
    });
    if (!response.ok)
      {
      setError('Table preferences could not be reset.');
      return;
      }
    suppressPersistence.current = true;
    table.resetRowSelection();
    window.location.assign(pathname);
  }
  const selected = table.getSelectedRowModel().rows.map((row) => row.original);
  const filtered = ['q', 'status', 'audience', 'from', 'to', 'filters'].some((key) => searchParams.has(key));
  return <>
    <TablePreferenceSync table={tableType as AdminTableIdentifier} />
    <DataTable table={table} pageSizeOptions={[10, 25, 50, 100]} emptyState={<div><strong>{filtered ? 'No records match this view' : 'No records yet'}</strong><span className="block text-muted-foreground">{filtered ? 'Change or clear the filters.' : 'Create a record to get started.'}</span></div>} actionBar={<ActionBar open={selected.length > 0} onOpenChange={(open) => { if (!open) table.resetRowSelection(); }}><ActionBarSelection>{selected.length} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={() => downloadSelected(selected, config.columns, tableType)}>Export selected CSV</ActionBarItem><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}>
      <DataTableAdvancedToolbar className="mt-5 rounded-xl border bg-background p-3" table={table}>
        <div className="flex min-w-64 flex-1 gap-2"><Input aria-label={config.searchLabel} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') update({ q: search.trim() }); }} placeholder="Search…" type="search" value={search} /><Button onClick={() => update({ q: search.trim() })} type="button">Search</Button></div>
        <DataTableFilterMenu table={table} debounceMs={debounceMs} shallow={shallow} throttleMs={throttleMs} />
        <DataTableFilterList table={table} debounceMs={debounceMs} shallow={shallow} throttleMs={throttleMs} />
        <DataTableSortList table={table} />
        <select aria-label="Filter by status" className="h-9 rounded-md border bg-background px-2 text-sm" onChange={(event) => update({ status: event.target.value })} value={searchParams.get('status') ?? ''}><option value="">All statuses</option>{config.statuses.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}</select>
        {tableType === 'content_pages' && <select aria-label="Filter by audience" className="h-9 rounded-md border bg-background px-2 text-sm" onChange={(event) => update({ audience: event.target.value })} value={searchParams.get('audience') ?? ''}><option value="">All audiences</option>{['public', 'member', 'judge', 'steward', 'veterinarian'].map((value) => <option key={value} value={value}>{value}</option>)}</select>}
        {config.dateFilter && <><label className="text-sm">From <input className="h-9 rounded-md border bg-background px-2" onChange={(event) => update({ from: event.target.value })} type="date" value={searchParams.get('from') ?? ''} /></label><label className="text-sm">To <input className="h-9 rounded-md border bg-background px-2" onChange={(event) => update({ to: event.target.value })} type="date" value={searchParams.get('to') ?? ''} /></label></>}
        <Button onClick={() => void reset()} size="sm" type="button" variant="ghost">Reset to default</Button>
      </DataTableAdvancedToolbar>
      <p aria-live="polite" className="px-1 text-sm text-muted-foreground">{total} matching records</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </DataTable>
  </>;
}
