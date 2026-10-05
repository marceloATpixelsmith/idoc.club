'use client';

import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table';
import { Mail } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
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
import { MEMBERSHIP_TYPE_FILTERS, type DirectoryMemberRow, type MemberDirectoryFilters } from '@/lib/directory/member-directory';

const PAGE_SIZES = [10, 25, 50, 100];
const TYPE_LABELS: Record<string, string> = {
  combo: 'Judge + Steward', judge: 'Judge', steward: 'Steward', veterinarian: 'Veterinarian',
};
const TYPE_OPTIONS = MEMBERSHIP_TYPE_FILTERS.map((value) => ({ value, label: TYPE_LABELS[value] }));
const FEDERATION_OPTIONS = COUNTRY_OPTIONS.map(({ code, name }) => ({ value: code, label: name }));
const REGION_OPTIONS = IDOC_REGIONS.map((value) => ({ value, label: value }));

type ListingFilters = Omit<MemberDirectoryFilters, 'page' | 'pageSize' | 'sort'> & {
  page: number;
  sort: { id: string; desc: boolean }[];
};

function header(id: string, label: string) {
  return ({ column }: { column: Parameters<typeof DataTableColumnHeader>[0]['column'] }) =>
    <DataTableColumnHeader column={column} label={label} />;
}
function initialFilterState(filters: ListingFilters): ColumnFiltersState {
  return [
    ['membershipType', filters.membershipType],
    ['federation', filters.federation],
    ['region', filters.region],
  ].flatMap(([id, value]) => Array.isArray(value) && value.length ? [{ id: id as string, value }] : []);
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
    const membershipType = filterToken(state.columnFilters, 'membershipType');
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
        header: header('name', 'Name'), meta: { label: 'Name' },
        cell: ({ row }) => <span className="font-medium uppercase">{row.original.lastName}, {row.original.firstName}</span>,
      },
      {
        id: 'email', accessorKey: 'email', header: header('email', 'Email'), meta: { label: 'Email' },
        cell: ({ row }) => <a className="underline underline-offset-4" href={`mailto:${row.original.email}`}>{row.original.email}</a>,
      },
      {
        id: 'type', accessorKey: 'membershipType', enableColumnFilter: true,
        header: header('type', 'Membership Type'),
        meta: { label: 'Membership Type', options: TYPE_OPTIONS, variant: 'multiSelect' },
        cell: ({ row }) => row.original.roles?.length
          ? row.original.roles.map((role) => TYPE_LABELS[role.roleType] ?? role.roleType).join('; ')
          : '—',
      },
      {
        id: 'federation', accessorKey: 'federation', enableColumnFilter: true,
        header: header('federation', 'National Federation'),
        meta: { label: 'National Federation', options: FEDERATION_OPTIONS, variant: 'multiSelect' },
        cell: ({ row }) => row.original.federation ? countryNameForCode(row.original.federation) : '—',
      },
      {
        id: 'region', accessorKey: 'region', enableColumnFilter: true,
        header: header('region', 'IDOC Region'),
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
