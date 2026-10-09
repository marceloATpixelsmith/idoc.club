'use client';

import {
  type ColumnDef, type ColumnFiltersState, type ColumnOrderState, type VisibilityState,
  getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
} from '@tanstack/react-table';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
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

export type ReadOnlyRow = { id: string; link?: string; [key: string]: string | undefined };
type DateFilterValue = { from?: string; to?: string };

export function AdminReadOnlyTable({
  columns: definitions, dateColumn, empty, rows, searchLabel, statusColumn, tableType,
}: {
  columns: { id: string; label: string }[];
  /** Id of a column holding an ISO date/timestamp string to add a date-range filter for, rendered
   * next to the search box (client-side, like the rest of this table's filtering). */
  dateColumn?: string;
  empty: string;
  rows: ReadOnlyRow[];
  searchLabel: string;
  statusColumn?: string;
  tableType: 'notifications' | 'reconciliation';
}) {
  const [search, setSearch] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [exportNotice, setExportNotice] = useState('');
  const [dateDraftActive, setDateDraftActive] = useState(false);
  const [dateResetSignal, setDateResetSignal] = useState(0);
  const options = useMemo(() => [...new Set(rows.map((row) => row[statusColumn ?? '']).filter((value): value is string => Boolean(value)))].sort().map((value) => ({ label: value, value })), [rows, statusColumn]);
  const columns = useMemo<ColumnDef<ReadOnlyRow>[]>(() => {
    const definedColumns: ColumnDef<ReadOnlyRow>[] = [
      {
        id: 'select', enableHiding: false, enableSorting: false, size: 40,
        header: ({ table }) => <Checkbox aria-label="Select all rows on this page" checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')} onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))} />,
        cell: ({ row }) => <Checkbox aria-label={`Select row ${row.original.id}`} checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(Boolean(value))} />,
      },
      ...definitions.map(({ id, label }): ColumnDef<ReadOnlyRow> => ({
        id, accessorFn: (row) => id === 'attempts' ? Number(row[id] ?? 0) : row[id] ?? '',
        enableColumnFilter: id === statusColumn || id === dateColumn,
        filterFn: id === statusColumn
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
        meta: id === statusColumn ? { label, options, variant: 'select' } : { label },
        cell: ({ row }) => id === 'member' && row.original.link
          ? <Link className="underline" href={row.original.link}>{row.original[id] ?? 'View member'}</Link>
          : row.original[id] || '—',
      })),
    ];
    return definedColumns;
  }, [definitions, options, statusColumn, dateColumn]);
  const table = useReactTable({
    columns, data: rows, getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(), getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _id, value) => definitions.some(({ id }) => String(row.original[id] ?? '').toLowerCase().includes(String(value).toLowerCase())),
    initialState: { pagination: { pageIndex: 0, pageSize: 25 } },
    onColumnFiltersChange: setColumnFilters,
    onColumnOrderChange: setColumnOrder,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setSearch,
    state: { columnFilters, columnOrder, columnVisibility, globalFilter: search },
  });
  const selected = table.getSelectedRowModel().rows.map(({ original }) => original);
  const actionBarVisibility = useActionBarVisibility(selected.length);
  function exportSelected() {
    if (selected.length > 100)
      {
      setExportNotice('Select no more than 100 rows to export.');
      return;
      }
    const params = new URLSearchParams({ table: tableType });
    for (const row of selected) params.append('id', row.id);
    const anchor = document.createElement('a');
    anchor.href = `/api/admin/export/selected-reports?${params}`;
    anchor.download = `selected-${tableType}.csv`;
    anchor.click();
  }
  function onSearchChange(value: string) {
    setSearch(value);
    table.setPageIndex(0);
    table.resetRowSelection();
  }
  const dateFilterValue = dateColumn ? (table.getColumn(dateColumn)?.getFilterValue() as DateFilterValue | undefined) : undefined;
  const dateColumnLabel = definitions.find(({ id }) => id === dateColumn)?.label ?? dateColumn ?? '';
  return <DataTable table={table} pageSizeOptions={[10, 25, 50, 100]} emptyState={<span className="text-muted-foreground">{empty}</span>} actionBar={<ActionBar open={actionBarVisibility.open} onOpenChange={actionBarVisibility.onOpenChange}><ActionBarSelection>{selected.length} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={exportSelected}>Export selected CSV</ActionBarItem><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}>
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
