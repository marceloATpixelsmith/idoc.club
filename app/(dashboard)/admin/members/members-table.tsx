'use client';

import type { ColumnDef, HeaderContext, VisibilityState } from '@tanstack/react-table';
import { Archive, CircleCheck, CircleX, Clock3, Download, FlaskConical, Gavel, Shield, Stethoscope, UserCog, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { persistTablePreferences, TablePreferenceSync } from '@/components/admin/table-preference-sync';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection } from '@/components/ui/action-bar';
import { useDataTable } from '@/hooks/use-data-table';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import { getDefaultColumnOrder } from '@/lib/data-table';
import type { AdminMemberRow } from '@/lib/membership/admin-memberships';
import { COUNTRY_OPTIONS, countryNameForCode } from '@/lib/membership/countries';
import { IDOC_REGIONS } from '@/lib/membership/validation';

type Filters = {
  country?: string; direction: 'asc' | 'desc'; expiresFrom?: string; expiresTo?: string; federation?: string; filters?: string;
  membershipType?: string; page: number; pageSize: number; q?: string; region?: string; sort: string; status: string;
};

const OPTIONAL_COLUMNS = ['email', 'type', 'status', 'federation', 'country', 'region', 'expires', 'lastPayment', 'updated', 'actions'] as const;
const COLUMN_LABELS: Record<string, string> = { actions: 'Actions', country: 'Country', email: 'Email', expires: 'Expiration', federation: 'National federation', lastPayment: 'Last payment', name: 'Member name', region: 'IDOC region', status: 'Status', type: 'Membership type', updated: 'Updated' };
const STATUS_OPTIONS = [
  { label: 'Active members', value: 'active' }, { label: 'Expired members', value: 'expired' },
  { label: 'Archived members', value: 'archived' },
  { label: 'Administrators', value: 'administrator' }, { label: 'Superadmins', value: 'super_admin' },
  { label: 'Onboarding users', value: 'onboarding' }, { label: 'Test members', value: 'test' },
];
const TYPE_OPTIONS = [
  { label: 'Judge', value: 'judge' }, { label: 'Steward', value: 'steward' },
  { label: 'Judge & Steward', value: 'combo' }, { label: 'Veterinarian', value: 'veterinarian' },
];
const COUNTRY_FILTER_OPTIONS = COUNTRY_OPTIONS.map(({ code, name }) => ({ label: name, value: code }));
const REGION_FILTER_OPTIONS = IDOC_REGIONS.map((region) => ({ label: region, value: region }));
const TYPE_DISPLAY = {
  judge: { icon: Gavel, label: 'JUDGE' }, steward: { icon: Shield, label: 'STEWARD' },
  combo: { icon: Gavel, label: 'JUDGE & STEWARD' }, veterinarian: { icon: Stethoscope, label: 'VETERINARIAN' },
};
const STATUS_DISPLAY = {
  active: { icon: CircleCheck, label: 'ACTIVE' }, expired: { icon: Clock3, label: 'EXPIRED' },
  archived: { icon: Archive, label: 'ARCHIVED' }, administrator: { icon: UserCog, label: 'ADMINISTRATOR' },
  super_admin: { icon: Shield, label: 'SUPERADMIN' }, onboarding: { icon: UserRound, label: 'ONBOARDING' },
  test: { icon: FlaskConical, label: 'TEST' }, without_active: { icon: CircleX, label: 'WITHOUT ACTIVE MEMBERSHIP' },
};

function visibleState(searchParams: URLSearchParams, initial?: string[]): VisibilityState {
  const explicit = searchParams.getAll('column');
  const selected = explicit.length > 0 ? explicit : initial;
  if (!selected) return {};
  return Object.fromEntries(OPTIONAL_COLUMNS.map((column) => [column, selected.includes(column)]));
}

function memberHref(searchParams: URLSearchParams, profileId: number) { const params = new URLSearchParams(searchParams.toString()); params.set('profileId', String(profileId)); return params.toString(); }

function header(id: string) {
  return ({ column }: HeaderContext<AdminMemberRow, unknown>) => <DataTableColumnHeader column={column} label={COLUMN_LABELS[id] ?? id} />;
}

export function MembersTable({ filters, initialColumnOrder, initialVisibleColumns, pageSize, rows, total }: { defaultActive: boolean; filters: Filters; initialColumnOrder?: string; initialVisibleColumns?: string[]; pageSize: number; rows: AdminMemberRow[]; total: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(filters.q ?? '');
  const initialVisibility = useMemo(() => visibleState(new URLSearchParams(searchParams.toString()), initialVisibleColumns), []);
  const columns = useMemo<ColumnDef<AdminMemberRow>[]>(() => [
    { id: 'select', enableHiding: false, enableSorting: false, header: ({ table }) => <Checkbox aria-label="Select all members on this page" checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')} onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))} />, cell: ({ row }) => <Checkbox aria-label={`Select ${row.original.firstName ?? row.original.email} ${row.original.lastName ?? ''}`} checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(Boolean(value))} /> },
    { id: 'name', accessorFn: (row) => `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(), header: header('name'), meta: { label: 'Member name' }, cell: ({ row }) => row.original.profileId ? <Link className="font-medium underline" href={`${pathname}?${memberHref(searchParams, row.original.profileId)}`}>{row.original.firstName} {row.original.lastName}</Link> : <span className="text-muted-foreground">Profile not completed</span> },
    { accessorKey: 'email', header: header('email'), meta: { label: 'Email' }, cell: ({ row }) => <a className="underline" href={`mailto:${encodeURIComponent(row.original.email)}`}>{row.original.email}</a> },
    { id: 'type', accessorKey: 'membershipType', enableColumnFilter: true, header: header('type'), meta: { label: 'Membership type', options: TYPE_OPTIONS, variant: 'select' }, cell: ({ row }) => { const type = TYPE_DISPLAY[row.original.membershipType as keyof typeof TYPE_DISPLAY]; return type ? <span className="inline-flex items-center gap-2"><type.icon aria-hidden="true" className="size-4 shrink-0" />{row.original.membershipType === 'combo' && <Shield aria-hidden="true" className="size-4 shrink-0" />}{type.label}</span> : '—'; } },
    { accessorKey: 'status', enableColumnFilter: true, header: header('status'), meta: { label: 'Member status', options: STATUS_OPTIONS, variant: 'select' }, cell: ({ row }) => { const status = STATUS_DISPLAY[row.original.status as keyof typeof STATUS_DISPLAY]; return status ? <span className="inline-flex items-center gap-2"><status.icon aria-hidden="true" className="size-4 shrink-0" />{status.label}</span> : row.original.status.toUpperCase(); } },
    { accessorKey: 'federation', enableColumnFilter: true, header: header('federation'), meta: { label: 'National federation', options: COUNTRY_FILTER_OPTIONS, variant: 'select' }, cell: ({ row }) => row.original.federation ? countryNameForCode(row.original.federation) : '—' },
    { accessorKey: 'country', enableColumnFilter: true, header: header('country'), meta: { label: 'Address country', options: COUNTRY_FILTER_OPTIONS, variant: 'select' }, cell: ({ row }) => row.original.country ? countryNameForCode(row.original.country) : '—' },
    { accessorKey: 'region', enableColumnFilter: true, header: header('region'), meta: { label: 'IDOC region', options: REGION_FILTER_OPTIONS, variant: 'select' }, cell: ({ row }) => row.original.region ?? '—' },
    { id: 'expires', accessorKey: 'validUntil', header: header('expires'), meta: { label: 'Expiration date' }, cell: ({ row }) => row.original.validUntil ? new Date(`${row.original.validUntil}T00:00:00`).toLocaleDateString() : '—' },
    { id: 'lastPayment', accessorKey: 'lastPaymentAt', header: header('lastPayment'), meta: { label: 'Last payment' }, cell: ({ row }) => row.original.lastPaymentAt ? new Date(row.original.lastPaymentAt).toLocaleDateString() : '—' },
    { id: 'updated', accessorKey: 'updatedAt', header: header('updated'), meta: { label: 'Updated' }, cell: ({ row }) => new Date(row.original.updatedAt).toLocaleDateString() },
    { id: 'actions', enableHiding: true, enableSorting: false, header: 'Actions', cell: ({ row }) => <div className="flex flex-wrap gap-2">{row.original.profileId && <><Link className="underline" href={`${pathname}?${memberHref(searchParams, row.original.profileId)}`}>Edit</Link><Link className="underline" href={`/admin/payments?profileId=${row.original.profileId}`}>Payment</Link></>}<a className="underline" href={`mailto:${encodeURIComponent(row.original.email)}`}>Email</a></div> },
  ], [pathname, searchParams]);
  const initialSorting = filters.sort ? [{ desc: filters.direction === 'desc', id: filters.sort as keyof AdminMemberRow }] : [{ desc: false, id: 'name' as keyof AdminMemberRow }];
  const { table } = useDataTable({
    columns, data: rows,
    // Simple (non-advanced) mode is required for the auto-rendered faceted filters below to sync
    // through `column.setFilterValue` -- advanced mode no-ops that path.
    enableAdvancedFilter: false,
    getRowId: (row) => row.profileId ? `profile-${row.profileId}` : `user-${row.userId}`,
    initialState: { columnOrder: (searchParams.get('columnOrder') ?? initialColumnOrder)?.split(','), columnVisibility: initialVisibility, pagination: { pageIndex: filters.page - 1, pageSize }, sorting: initialSorting },
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    queryKeys: { page: 'page', perPage: 'pageSize', sort: 'sort' },
    shallow: false,
  });

  useEffect(() => setSearch(filters.q ?? ''), [filters.q]);
  useEffect(() => {
    table.setColumnVisibility(visibleState(new URLSearchParams(searchParams.toString()), initialVisibleColumns));
    table.resetRowSelection();
  }, [searchParams, initialVisibleColumns, table]);
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const preferences = {
      columns: OPTIONAL_COLUMNS.filter((column) => table.getState().columnVisibility[column] !== false),
      columnOrder: params.get('columnOrder') ?? initialColumnOrder,
      pageSize: Number(params.get('pageSize') ?? pageSize),
      q: params.get('q') ?? undefined,
      sort: params.get('sort') ?? undefined,
      status: params.get('status') ?? undefined,
    };
    void persistTablePreferences('memberships', preferences);
  }, [pageSize, searchParams, table]);
  useEffect(() => {
    const state = table.getState();
    const columns = OPTIONAL_COLUMNS.filter((column) => state.columnVisibility[column] !== false);
    const params = new URLSearchParams(searchParams.toString());
    const current = params.getAll('column');
    if (current.length === columns.length && current.every((value, index) => value === columns[index])) return;
    params.delete('column');
    for (const column of columns) params.append('column', column);
    void persistTablePreferences('memberships', { columns, columnOrder: params.get('columnOrder') ?? initialColumnOrder, pageSize: state.pagination.pageSize, q: params.get('q') ?? undefined, sort: params.get('sort') ?? undefined, status: params.get('status') ?? undefined });
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [table.getState().columnVisibility]);

  function update(values: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value); else params.delete(key);
    }
    params.delete('page');
    router.push(`${pathname}?${params}`);
  }
  const debouncedSearch = useDebouncedCallback((value: string) => update({ q: value || undefined }), 300);
  const reset = async () => { await fetch('/api/admin/table-preferences/memberships', { credentials: 'same-origin', headers: { 'x-idoc-csrf': decodeURIComponent(document.cookie.match(/(?:^|; )(?:__Host-)?idoc-csrf=([^;]+)/)?.[1] ?? '') }, method: 'DELETE' }); table.setColumnOrder(getDefaultColumnOrder(columns)); table.resetRowSelection(); router.push(`${pathname}?status=active`); };
  const exportParams = new URLSearchParams(searchParams.toString()); exportParams.delete('page'); exportParams.delete('profileId'); exportParams.delete('column');
  const selected = table.getSelectedRowModel().rows.length;
  const selectedExportParams = new URLSearchParams(exportParams.toString());
  for (const row of table.getSelectedRowModel().rows) selectedExportParams.append('selectedUserId', String(row.original.userId));
  const manuallyFiltered = ['q', 'expiresFrom', 'expiresTo'].some((key) => searchParams.has(key));
  const hasActiveView = [...searchParams.keys()].some((key) => !['column', 'page', 'pageSize', 'profileId'].includes(key));

  return <>
    <TablePreferenceSync table="memberships" />
    <DataTable table={table} pageSizeOptions={[10, 25, 50, 100]} emptyState={<div><strong>{hasActiveView ? 'No users match this view' : 'No users exist'}</strong><span className="mt-1 block text-muted-foreground">{hasActiveView ? 'Edit or clear filters to broaden the result set.' : 'Users appear here after account creation.'}</span></div>} actionBar={<ActionBar onOpenChange={(open) => { if (!open) table.resetRowSelection(); }} open={selected > 0}><ActionBarSelection>{selected} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={() => { const anchor = document.createElement('a'); anchor.href = `/api/admin/export/members?${selectedExportParams}`; anchor.download = 'selected-members.csv'; anchor.click(); }}>Export selected CSV</ActionBarItem><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}>
      <DataTableToolbar
        className="mt-5 rounded-xl border bg-background p-3"
        table={table}
        isFiltered={manuallyFiltered}
        onReset={() => update({ expiresFrom: undefined, expiresTo: undefined, q: undefined })}
        leading={<>
          <Input aria-label="Search member name or email" className="h-8 w-40 lg:w-56" onChange={(event) => { setSearch(event.target.value); debouncedSearch(event.target.value); }} placeholder="Search name or email…" type="search" value={search} />
          <DateRangeFilter from={filters.expiresFrom} label="Expires" onChange={(expiresFrom, expiresTo) => update({ expiresFrom, expiresTo })} to={filters.expiresTo} />
        </>}
      >
        <DataTableSortList table={table} />
        <Button asChild aria-label="Download These results" data-idoc-table-control size="icon" variant="outline"><Link aria-label="Download These results" download href={`/api/admin/export/members?${exportParams}`} title="Download These results"><Download aria-hidden="true" /></Link></Button>
        <Button onClick={reset} size="sm" type="button" variant="ghost">Reset to default</Button>
      </DataTableToolbar>
      <p aria-live="polite" className="px-1 text-sm text-muted-foreground">{total} matching members</p>
    </DataTable>
  </>;
}
