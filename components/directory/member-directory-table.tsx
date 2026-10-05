'use client';

import type { ColumnDef, ColumnFiltersState, HeaderContext } from '@tanstack/react-table';
import { Mail } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableActionsRow } from '@/components/data-table/data-table-actions-row';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDataTable, type DataTableLiveState } from '@/hooks/use-data-table';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import { countryNameForCode, COUNTRY_OPTIONS } from '@/lib/membership/countries';
import { IDOC_REGIONS } from '@/lib/membership/validation';
import type { DirectoryMemberRow, DirectorySort } from '@/lib/directory/member-directory';

const PAGE_SIZES = [10, 25, 50, 100];
const MEMBERSHIP_TYPE_FILTERS = ['judge', 'steward', 'combo', 'veterinarian'] as const;
const TYPE_LABELS: Record<string, string> = {
  combo: 'Judge + Steward', judge: 'Judge', steward: 'Steward', veterinarian: 'Veterinarian',
};
const TYPE_OPTIONS = MEMBERSHIP_TYPE_FILTERS.map((value) => ({ value, label: TYPE_LABELS[value] }));
const FEDERATION_OPTIONS = COUNTRY_OPTIONS.map(({ code, name }) => ({ value: code, label: name }));
const REGION_OPTIONS = IDOC_REGIONS.map((value) => ({ value, label: value }));

type ListingFilters = {
  federation: string[]; membershipType: string[]; region: string[];
  page: number; q?: string; sort: DirectorySort[];
};

function header(label: string) {
  return ({ column }: HeaderContext<DirectoryMemberRow, unknown>) =>
    <DataTableColumnHeader column={column} label={label} />;
}
function initialFilterState(filters: ListingFilters): ColumnFiltersState {
  const result: ColumnFiltersState = [];
  if (filters.membershipType.length) result.push({ id: 'type', value: filters.membershipType });
  if (filters.federation.length) result.push({ id: 'federation', value: filters.federation });
  if (filters.region.length) result.push({ id: 'region', value: filters.region });
  return result;
}
function filterToken(filters: ColumnFiltersState, id: string) {
  const value = filters.find((filter) => filter.id === id)?.value;
  return Array.isArray(value) && value.length ? value.join(',') : undefined;
}

export function MemberDirectoryTable({ filters, pageSize, rows, total }: {
  filters: ListingFilters;
  pageSize: number;
  rows: DirectoryMemberRow[];
  total: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState(Array.isArray(filters.q) ? '' : filters.q ?? '');
  const [isPending, startTransition] = useTransition();

  function navigate(state: DataTableLiveState, query = search) {
    const params = new URLSearchParams({ tab: 'directory' });
    if (query.trim()) params.set('q', query.trim());
    const membershipType = filterToken(state.columnFilters, 'type');
    const federation = filterToken(state.columnFilters, 'federation');
    const region = filterToken(state.columnFilters, 'region');
    if (membershipType) params.set('membershipType', membershipType);
    if (federation) params.set('federation', federation);
    if (region) params.set('region', region);
    if (state.pagination.pageIndex > 0) params.set('page', String(state.pagination.pageIndex + 1));
    if (state.pagination.pageSize !== 25) params.set('pageSize', String(state.pagination.pageSize));
    if (state.sorting.length) params.set('sort', JSON.stringify(state.sorting));
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  const { table } = useDataTable({
    columns: useMemo<ColumnDef<DirectoryMemberRow>[]>(() => [
      {
        id: 'name', accessorFn: (row) => `${row.lastName}, ${row.firstName}`,
        header: header('Name'), meta: { label: 'Name' },
        cell: ({ row }) => <span className="font-medium uppercase">{row.original.lastName}, {row.original.firstName}</span>,
      },
      {
        id: 'email', accessorKey: 'email', header: header('Email'), meta: { label: 'Email' },
        cell: ({ row }) => <a className="underline underline-offset-4" href={`mailto:${row.original.email}`}>{row.original.email}</a>,
      },
      {
        id: 'type', accessorKey: 'membershipType', enableColumnFilter: true,
        header: header('Membership Type'),
        meta: { label: 'Membership Type', options: TYPE_OPTIONS, variant: 'multiSelect' },
        cell: ({ row }) => row.original.roles?.length
          ? row.original.roles.map((role) => TYPE_LABELS[role.roleType] ?? role.roleType).join('; ')
          : '—',
      },
      {
        id: 'federation', accessorKey: 'federation', enableColumnFilter: true,
        header: header('National Federation'),
        meta: { label: 'National Federation', options: FEDERATION_OPTIONS, variant: 'multiSelect' },
        cell: ({ row }) => row.original.federation ? countryNameForCode(row.original.federation) : '—',
      },
      {
        id: 'region', accessorKey: 'region', enableColumnFilter: true,
        header: header('IDOC Region'),
        meta: { label: 'IDOC Region', options: REGION_OPTIONS, variant: 'multiSelect' },
        cell: ({ row }) => row.original.region ?? '—',
      },
      {
        id: 'actions', enableHiding: false, enableSorting: false, size: 56,
        header: () => <span>Actions</span>,
        cell: ({ row }) => <Button asChild aria-label={`Email ${row.original.firstName} ${row.original.lastName}`} title="Email member" variant="ghost" size="icon-sm">
          <a href={`mailto:${row.original.email}`}><Mail aria-hidden="true" /></a>
        </Button>,
      },
    ], []),
    data: rows,
    initialState: {
      columnFilters: initialFilterState(filters),
      pagination: { pageIndex: filters.page - 1, pageSize },
      sorting: filters.sort,
    },
    getRowId: (row) => row.email,
    onLiveStateChange: (state) => navigate(state),
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    startTransition,
  });

  useEffect(() => {
    const nextSearch = filters.q ?? '';
    setSearch((current) => current === nextSearch ? current : nextSearch);
    const nextFilters = initialFilterState(filters);
    if (JSON.stringify(table.getState().columnFilters) !== JSON.stringify(nextFilters)) table.setColumnFilters(nextFilters);
    if (JSON.stringify(table.getState().sorting) !== JSON.stringify(filters.sort)) table.setSorting(filters.sort);
    if (table.getState().pagination.pageIndex !== filters.page - 1 || table.getState().pagination.pageSize !== pageSize) {
      table.setPagination({ pageIndex: filters.page - 1, pageSize });
    }
  }, [filters, pageSize, table]);

  const debouncedSearch = useDebouncedCallback((value: string) => {
    const state = table.getState();
    navigate({
      pagination: { ...state.pagination, pageIndex: 0 },
      sorting: state.sorting,
      columnFilters: state.columnFilters,
    }, value);
  }, 300);

  function resetAll() {
    setSearch('');
    table.resetColumnFilters(true);
    const state = table.getState();
    navigate({
      pagination: { ...state.pagination, pageIndex: 0 },
      sorting: state.sorting,
      columnFilters: [],
    }, '');
  }

  const hasFilters = table.getState().columnFilters.length > 0;
  const hasSearch = Boolean(search.trim());
  return <>
    <DataTableToolbar
      className="mt-5 rounded-xl border bg-background p-3"
      table={table}
      isFiltered={hasFilters}
      pending={isPending}
      onReset={resetAll}
      leading={<Input
        aria-label="Search member name or email"
        className="h-8 w-40 lg:w-56"
        onChange={(event) => { const value = event.target.value; setSearch(value); debouncedSearch(value); }}
        placeholder="Search name or email…"
        type="search"
        value={search}
      />}
    />
    <DataTableActionsRow count={`${total} matching members`} table={table}>
      <DataTableSortList table={table} />
    </DataTableActionsRow>
    <DataTable
      className="mt-2"
      table={table}
      pageSizeOptions={PAGE_SIZES}
      loading={isPending}
      emptyState={<div>
        <strong>{hasFilters || hasSearch ? 'No members match this view' : 'No active members to show'}</strong>
        <span className="mt-1 block text-muted-foreground">{hasFilters || hasSearch ? 'Edit or clear filters to broaden the result set.' : 'Active members will appear here.'}</span>
      </div>}
    />
  </>;
}
