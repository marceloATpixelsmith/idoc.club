'use client';

import {
  type ColumnDef, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
} from '@tanstack/react-table';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableAdvancedToolbar } from '@/components/data-table/data-table-advanced-toolbar';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection } from '@/components/ui/action-bar';
import { Input } from '@/components/ui/input';

export type ReadOnlyRow = { id: string; link?: string; [key: string]: string | undefined };

export function AdminReadOnlyTable({
  columns: definitions, empty, rows, searchLabel, statusColumn, tableType,
}: {
  columns: { id: string; label: string }[];
  empty: string;
  rows: ReadOnlyRow[];
  searchLabel: string;
  statusColumn?: string;
  tableType: 'notifications' | 'reconciliation';
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const options = useMemo(() => [...new Set(rows.map((row) => row[statusColumn ?? '']).filter((value): value is string => Boolean(value)))].sort(), [rows, statusColumn]);
  const columns = useMemo<ColumnDef<ReadOnlyRow>[]>(() => [
    {
      id: 'select', enableHiding: false, enableSorting: false,
      header: ({ table }) => <input aria-label="Select all rows on this page" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} type="checkbox" />,
      cell: ({ row }) => <input aria-label={`Select row ${row.original.id}`} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} type="checkbox" />,
    },
    ...definitions.map(({ id, label }): ColumnDef<ReadOnlyRow> => ({
      id, accessorFn: (row) => id === 'attempts' ? Number(row[id] ?? 0) : row[id] ?? '',
      filterFn: id === statusColumn ? 'equalsString' : undefined,
      header: ({ column }) => <DataTableColumnHeader column={column} label={label} />,
      meta: { label },
      cell: ({ row }) => id === 'member' && row.original.link
        ? <Link className="underline" href={row.original.link}>{row.original[id] ?? 'View member'}</Link>
        : row.original[id] || '—',
    })),
  ], [definitions]);
  const table = useReactTable({
    columns, data: rows, getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(), getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _id, value) => definitions.some(({ id }) => String(row.original[id] ?? '').toLowerCase().includes(String(value).toLowerCase())),
    initialState: { pagination: { pageIndex: 0, pageSize: 25 } },
    state: { globalFilter: search, columnFilters: status && statusColumn ? [{ id: statusColumn, value: status }] : [] },
    onGlobalFilterChange: setSearch,
  });
  const selected = table.getSelectedRowModel().rows.map(({ original }) => original);
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
  return <DataTable table={table} pageSizeOptions={[10, 25, 50, 100]} emptyState={<span className="text-muted-foreground">{empty}</span>} actionBar={<ActionBar open={selected.length > 0} onOpenChange={(open) => { if (!open) table.resetRowSelection(); }}><ActionBarSelection>{selected.length} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={exportSelected}>Export selected CSV</ActionBarItem><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}>
    <DataTableAdvancedToolbar className="mt-4 rounded-xl border bg-background p-3" table={table}>
      <Input aria-label={searchLabel} className="max-w-xs" onChange={(event) => { setSearch(event.target.value); table.setPageIndex(0); table.resetRowSelection(); }} placeholder="Search…" type="search" value={search} />
      {statusColumn && <select aria-label={`Filter by ${statusColumn}`} className="h-9 rounded-md border bg-background px-2 text-sm" onChange={(event) => { setStatus(event.target.value); table.setPageIndex(0); table.resetRowSelection(); }} value={status}><option value="">All</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>}
      <DataTableSortList table={table} />
    </DataTableAdvancedToolbar>
    <p className="px-1 text-sm text-muted-foreground">{table.getFilteredRowModel().rows.length} matching records</p>
    {exportNotice && <p className="px-1 text-sm text-red-600" role="alert">{exportNotice}</p>}
  </DataTable>;
}
