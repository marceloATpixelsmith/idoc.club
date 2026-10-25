'use client';

import {
  type ColumnDef, type ColumnFiltersState, type ColumnOrderState, type PaginationState, type SortingState, type VisibilityState,
  getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
} from '@tanstack/react-table';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { persistTablePreferences } from '@/components/admin/table-preference-sync';
import type { AdminTableIdentifier, TablePreferenceState } from '@/lib/admin/table-preferences';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableActionsRow } from '@/components/data-table/data-table-actions-row';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection } from '@/components/ui/action-bar';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useActionBarVisibility } from '@/hooks/use-action-bar-visibility';
import { getDefaultColumnOrder } from '@/lib/data-table';
import { formatTableDate } from '@/lib/format';

export type ReadOnlyRow = { id: string; link?: string; [key: string]: string | undefined };
type DateFilterValue = { from?: string; to?: string };
const VIEW_CHANGE_SKELETON_MS = 400;
const SAVE_DELAY_MS = 500;
const PAGE_SIZES = [10, 25, 50, 100];

/** Reads a saved JSON view value back defensively: anything malformed or naming a column this table does not have is ignored. */
function readSavedJson<T>(value: unknown, accept: (parsed: unknown) => T | null): T | null {
  if (typeof value !== 'string') return null;
  try { return accept(JSON.parse(value)); } catch { return null; }
}

// Any ISO timestamp cell (created/sent/detected...) is shown as dd/mm/yyyy; the raw value stays in
// the row for filtering, sorting, and export.
function formatReadOnlyCell(value: string | undefined) {
  if (!value) return '—';
  return /^\d{4}-\d{2}-\d{2}T/.test(value) ? formatTableDate(value) : value;
}

export function AdminReadOnlyTable({
  bulkActions, columns: definitions, dateColumn, empty, filterColumns, initialPreferences, preferenceKey, rows, searchLabel, statusColumn, tableType,
}: {
  /** Extra items for the selection bar (rendered after Export), given the selected rows and a way to clear the selection. */
  bulkActions?: (context: { clearSelection: () => void; selected: ReadOnlyRow[] }) => ReactNode;
  columns: { id: string; label: string }[];
  /** Id of a column holding an ISO date/timestamp string to add a date-range filter for, rendered
   * next to the search box (client-side, like the rest of this table's filtering). */
  dateColumn?: string;
  empty: string;
  /** Ids of further columns that get a multi-select value filter beside the status one (for example a Type column). */
  filterColumns?: string[];
  rows: ReadOnlyRow[];
  searchLabel: string;
  statusColumn?: string;
  /** Selected-row CSV export is served by `/api/admin/export/selected-reports`; a table without a server export omits `tableType` and the Export action. */
  tableType?: 'notifications' | 'reconciliation';
  /** Where this table's view (search, filters, sort, shown columns, page size) is saved for the signed-in administrator, like every admin table. */
  preferenceKey?: AdminTableIdentifier;
  /** The administrator's saved view, loaded on the server so a refresh restores it. */
  initialPreferences?: TablePreferenceState | null;
}) {
  const saved = initialPreferences ?? {};
  const columnIds = definitions.map(({ id }) => id);
  const [search, setSearch] = useState(typeof saved.q === 'string' ? saved.q : '');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => readSavedJson(saved.filters, (parsed) => Array.isArray(parsed)
    ? parsed.filter((item): item is { id: string; value: unknown } => Boolean(item) && typeof item === 'object' && columnIds.includes((item as { id?: string }).id ?? '') && ((Array.isArray((item as { value?: unknown }).value) && ((item as { value: unknown[] }).value).every((entry) => typeof entry === 'string')) || (typeof (item as { value?: unknown }).value === 'object' && (item as { value?: unknown }).value !== null && !Array.isArray((item as { value?: unknown }).value))))
    : null) ?? []);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => Array.isArray(saved.columns) ? Object.fromEntries(columnIds.filter((id) => !(saved.columns as string[]).includes(id)).map((id) => [id, false])) : {});
  const [sorting, setSorting] = useState<SortingState>(() => readSavedJson(saved.sort, (parsed) => Array.isArray(parsed)
    ? parsed.filter((item): item is { desc: boolean; id: string } => Boolean(item) && typeof item === 'object' && columnIds.includes((item as { id?: string }).id ?? '') && typeof (item as { desc?: unknown }).desc === 'boolean')
    : null) ?? []);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(typeof saved.columnOrder === 'string' ? saved.columnOrder.split(',').filter(Boolean) : []);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: typeof saved.pageSize === 'number' && PAGE_SIZES.includes(saved.pageSize) ? saved.pageSize : 25 });
  const [exportNotice, setExportNotice] = useState('');
  const [dateDraftActive, setDateDraftActive] = useState(false);
  const [dateResetSignal, setDateResetSignal] = useState(0);
  // Filtering, searching and sorting here happen in the browser, so there is no request to wait for; the pulsing skeleton is still shown briefly so every table
  // reacts to a filter the same way (docs/29). It is re-armed by each change and clears shortly after the last one.
  const [viewChanging, setViewChanging] = useState(false);
  const viewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flashSkeleton = useCallback(() => {
    setViewChanging(true);
    clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(() => setViewChanging(false), VIEW_CHANGE_SKELETON_MS);
  }, []);
  useEffect(() => () => clearTimeout(viewTimer.current), []);
  const filterIds = useMemo(() => [...new Set([statusColumn, ...(filterColumns ?? [])].filter((id): id is string => Boolean(id)))], [statusColumn, filterColumns]);
  const optionsById = useMemo(() => Object.fromEntries(filterIds.map((id) => [id, [...new Set(rows.map((row) => row[id]).filter((value): value is string => Boolean(value)))].sort().map((value) => ({ label: value, value }))])), [rows, filterIds]);
  const columns = useMemo<ColumnDef<ReadOnlyRow>[]>(() => {
    const definedColumns: ColumnDef<ReadOnlyRow>[] = [
      {
        id: 'select', enableHiding: false, enableSorting: false, size: 40,
        header: ({ table }) => <Checkbox aria-label="Select all rows on this page" checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')} onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))} />,
        cell: ({ row }) => <Checkbox aria-label={`Select row ${row.original.id}`} checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(Boolean(value))} />,
      },
      ...definitions.map(({ id, label }): ColumnDef<ReadOnlyRow> => ({
        id, accessorFn: (row) => id === 'attempts' ? Number(row[id] ?? 0) : row[id] ?? '',
        enableColumnFilter: filterIds.includes(id) || id === dateColumn,
        filterFn: filterIds.includes(id)
          ? (row, columnId, filterValue: string[]) => filterValue.includes(String(row.getValue(columnId)))
          : id === dateColumn
            ? (row, columnId, filterValue: DateFilterValue) => {
                const key = String(row.getValue(columnId) ?? '').slice(0, 10);
                if (!key) return false;
                if (filterValue.from && key < filterValue.from) return false;
                if (filterValue.to && key > filterValue.to) return false;
                return true;
              }
            : undefined,
        header: ({ column }) => <DataTableColumnHeader column={column} label={label} />,
        meta: filterIds.includes(id) ? { label, options: optionsById[id], variant: 'multiSelect' } : { label },
        cell: ({ row }) => id === 'member' && row.original.link
          ? <Link className="underline" href={row.original.link}>{row.original[id] ?? 'View member'}</Link>
          : formatReadOnlyCell(row.original[id]),
      })),
    ];
    return definedColumns;
  }, [definitions, filterIds, optionsById, dateColumn]);
  const table = useReactTable({
    columns, data: rows, getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(), getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _id, value) => definitions.some(({ id }) => String(row.original[id] ?? '').toLowerCase().includes(String(value).toLowerCase())),
    onColumnFiltersChange: (updater) => { flashSkeleton(); setColumnFilters(updater); },
    onColumnOrderChange: setColumnOrder,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    onGlobalFilterChange: (updater) => { flashSkeleton(); setSearch(updater); },
    onSortingChange: (updater) => { flashSkeleton(); setSorting(updater); },
    state: { columnFilters, columnOrder, columnVisibility, globalFilter: search, pagination, sorting },
  });
  // Save the view for this administrator whenever it changes (not the page number), so a refresh restores it, like every admin table.
  const firstSave = useRef(true);
  useEffect(() => {
    if (!preferenceKey) return;
    if (firstSave.current) { firstSave.current = false; return; }
    const timer = setTimeout(() => {
      const preferences: TablePreferenceState = {};
      if (search) preferences.q = search;
      if (columnFilters.length > 0) preferences.filters = JSON.stringify(columnFilters);
      if (sorting.length > 0) preferences.sort = JSON.stringify(sorting);
      const shown = columnIds.filter((id) => columnVisibility[id] !== false);
      if (shown.length !== columnIds.length) preferences.columns = shown;
      if (columnOrder.length > 0) preferences.columnOrder = columnOrder.join(',');
      if (pagination.pageSize !== 25) preferences.pageSize = pagination.pageSize;
      void persistTablePreferences(preferenceKey, preferences).catch(() => undefined);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- columnIds is derived from the stable column definitions.
  }, [columnFilters, columnOrder, columnVisibility, pagination.pageSize, preferenceKey, search, sorting]);
  const selected = table.getSelectedRowModel().rows.map(({ original }) => original);
  const actionBarVisibility = useActionBarVisibility(selected.length);
  function exportSelected() {
    if (selected.length > 100)
      {
      setExportNotice('Select no more than 100 rows to export.');
      return;
      }
    if (!tableType) return;
    const params = new URLSearchParams({ table: tableType });
    for (const row of selected) params.append('id', row.id);
    const anchor = document.createElement('a');
    anchor.href = `/api/admin/export/selected-reports?${params}`;
    anchor.download = `selected-${tableType}.csv`;
    anchor.click();
  }
  function onSearchChange(value: string) {
    flashSkeleton();
    setSearch(value);
    table.setPageIndex(0);
    table.resetRowSelection();
  }
  const dateFilterValue = dateColumn ? (table.getColumn(dateColumn)?.getFilterValue() as DateFilterValue | undefined) : undefined;
  const dateColumnLabel = definitions.find(({ id }) => id === dateColumn)?.label ?? dateColumn ?? '';
  return <DataTable loading={viewChanging} table={table} pageSizeOptions={[10, 25, 50, 100]} emptyState={<span className="text-muted-foreground">{empty}</span>} actionBar={<ActionBar open={actionBarVisibility.open} onOpenChange={actionBarVisibility.onOpenChange}><ActionBarSelection>{selected.length} selected</ActionBarSelection><ActionBarGroup>{tableType ? <ActionBarItem onSelect={exportSelected}>Export selected CSV</ActionBarItem> : null}{bulkActions?.({ clearSelection: () => table.resetRowSelection(), selected })}<ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}>
    <DataTableToolbar
      className="mt-4 rounded-xl border bg-background p-3"
      table={table}
      isFiltered={Boolean(search) || dateDraftActive}
      onReset={() => { onSearchChange(''); setDateResetSignal((signal) => signal + 1); }}
      leading={<>
        <Input aria-label={searchLabel} className="h-8 w-40 lg:w-56" onChange={(event) => onSearchChange(event.target.value)} placeholder="Search…" type="search" value={search} />
        {dateColumn && (
          <DateRangeFilter
            from={dateFilterValue?.from}
            label={dateColumnLabel}
            onChange={(from, to) => {
              flashSkeleton();
              table.getColumn(dateColumn)?.setFilterValue(from || to ? { from, to } : undefined);
              table.setPageIndex(0);
              table.resetRowSelection();
            }}
            onDraftActiveChange={setDateDraftActive}
            resetSignal={dateResetSignal}
            to={dateFilterValue?.to}
          />
        )}
      </>}
    />
    <DataTableActionsRow count={`${table.getFilteredRowModel().rows.length} matching records`} table={table}>
      <DataTableSortList table={table} />
    </DataTableActionsRow>
    {exportNotice && <p className="px-1 text-sm text-red-600" role="alert">{exportNotice}</p>}
  </DataTable>;
}
