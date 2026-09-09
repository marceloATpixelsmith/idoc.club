'use client';

import type { ColumnDef, HeaderContext, VisibilityState } from '@tanstack/react-table';
import { Download, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableAdvancedToolbar } from '@/components/data-table/data-table-advanced-toolbar';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableFilterList } from '@/components/data-table/data-table-filter-list';
import { DataTableFilterMenu } from '@/components/data-table/data-table-filter-menu';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { persistTablePreferences, TablePreferenceSync } from '@/components/admin/table-preference-sync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection } from '@/components/ui/action-bar';
import { useDataTable } from '@/hooks/use-data-table';
import type { AdminMemberRow } from '@/lib/membership/admin-memberships';

type Filters = {
  country?: string; direction: 'asc' | 'desc'; expiresFrom?: string; expiresTo?: string; federation?: string; filters?: string;
  membershipType?: string; page: number; pageSize: number; q?: string; region?: string; sort: string; status: string;
};

const OPTIONAL_COLUMNS = ['email', 'type', 'status', 'federation', 'country', 'region', 'expires', 'lastPayment', 'updated', 'actions'] as const;
const COLUMN_LABELS: Record<string, string> = { actions: 'Actions', country: 'Country', email: 'Email', expires: 'Expiration', federation: 'National federation', lastPayment: 'Last payment', name: 'Member name', region: 'IDOC region', status: 'Status', type: 'Membership type', updated: 'Updated' };
const STATUS_OPTIONS = [
  { label: 'Active members', value: 'active' }, { label: 'Expired members', value: 'expired' },
  { label: 'Archived members', value: 'archived' }, { label: 'Without active membership', value: 'without_active' },
  { label: 'Administrators', value: 'administrator' }, { label: 'Superadmins', value: 'super_admin' },
  { label: 'Onboarding users', value: 'onboarding' }, { label: 'Test members', value: 'test' },
];
const TYPE_OPTIONS = [
  { label: 'Judge', value: 'judge' }, { label: 'Steward', value: 'steward' },
  { label: 'Judge & Steward', value: 'combo' }, { label: 'Veterinarian', value: 'veterinarian' },
];

function visibleState(searchParams: URLSearchParams, initial?: string[]): VisibilityState {
  const explicit = searchParams.getAll('column');
  const selected = explicit.length > 0 ? explicit : initial;
  if (!selected) return {};
  return Object.fromEntries(OPTIONAL_COLUMNS.map((column) => [column, selected.includes(column)]));
}

function header(id: string) {
  return ({ column }: HeaderContext<AdminMemberRow, unknown>) => <DataTableColumnHeader column={column} label={COLUMN_LABELS[id] ?? id} />;
}

export function MembersTable({ filters, initialVisibleColumns, pageSize, rows, total }: { defaultActive: boolean; filters: Filters; initialVisibleColumns?: string[]; pageSize: number; rows: AdminMemberRow[]; total: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(filters.q ?? '');
  const initialVisibility = useMemo(() => visibleState(new URLSearchParams(searchParams.toString()), initialVisibleColumns), []);
  const columns = useMemo<ColumnDef<AdminMemberRow>[]>(() => [
    { id: 'select', enableHiding: false, enableSorting: false, header: ({ table }) => <input aria-label="Select all members on this page" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} type="checkbox" />, cell: ({ row }) => <input aria-label={`Select ${row.original.firstName ?? row.original.email} ${row.original.lastName ?? ''}`} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} type="checkbox" /> },
    { id: 'name', accessorFn: (row) => `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(), header: header('name'), meta: { label: 'Member name' }, cell: ({ row }) => row.original.profileId ? <Link className="font-medium underline" href={`${pathname}?${new URLSearchParams({ ...Object.fromEntries(searchParams), profileId: String(row.original.profileId) })}`}>{row.original.firstName} {row.original.lastName}</Link> : <span className="text-muted-foreground">Profile not completed</span> },
    { accessorKey: 'email', header: header('email'), meta: { label: 'Email' }, cell: ({ row }) => <a className="underline" href={`mailto:${encodeURIComponent(row.original.email)}`}>{row.original.email}</a> },
    { id: 'type', accessorKey: 'membershipType', enableColumnFilter: true, header: header('type'), meta: { label: 'Membership type', options: TYPE_OPTIONS, variant: 'multiSelect' }, cell: ({ row }) => row.original.membershipType ?? '—' },
    { accessorKey: 'status', enableColumnFilter: true, header: header('status'), meta: { label: 'Member status', options: STATUS_OPTIONS, variant: 'multiSelect' } },
    { accessorKey: 'federation', enableColumnFilter: true, header: header('federation'), meta: { label: 'National federation', placeholder: 'e.g. DE', variant: 'text' }, cell: ({ row }) => row.original.federation ?? '—' },
    { accessorKey: 'country', enableColumnFilter: true, header: header('country'), meta: { label: 'Address country', placeholder: 'e.g. DE', variant: 'text' } },
    { accessorKey: 'region', enableColumnFilter: true, header: header('region'), meta: { label: 'IDOC region', variant: 'text' }, cell: ({ row }) => row.original.region ?? '—' },
    { id: 'expires', accessorKey: 'validUntil', enableColumnFilter: true, header: header('expires'), meta: { label: 'Expiration date', variant: 'dateRange' }, cell: ({ row }) => row.original.validUntil ?? '—' },
    { id: 'lastPayment', accessorKey: 'lastPaymentAt', header: header('lastPayment'), meta: { label: 'Last payment' }, cell: ({ row }) => row.original.lastPaymentAt ? new Date(row.original.lastPaymentAt).toLocaleDateString() : '—' },
    { id: 'updated', accessorKey: 'updatedAt', header: header('updated'), meta: { label: 'Updated' }, cell: ({ row }) => new Date(row.original.updatedAt).toLocaleDateString() },
    { id: 'actions', enableHiding: true, enableSorting: false, header: 'Actions', cell: ({ row }) => <div className="flex flex-wrap gap-2">{row.original.profileId && <><Link className="underline" href={`${pathname}?${new URLSearchParams({ ...Object.fromEntries(searchParams), profileId: String(row.original.profileId) })}`}>Edit</Link><Link className="underline" href={`/admin/payments?profileId=${row.original.profileId}`}>Payment</Link></>}<a className="underline" href={`mailto:${encodeURIComponent(row.original.email)}`}>Email</a></div> },
  ], [pathname, searchParams]);
  const initialSorting = filters.sort ? [{ desc: filters.direction === 'desc', id: filters.sort as keyof AdminMemberRow }] : [{ desc: false, id: 'name' as keyof AdminMemberRow }];
  const { table, shallow, debounceMs, throttleMs } = useDataTable({ columns, data: rows, enableAdvancedFilter: true, getRowId: (row) => row.profileId ? `profile-${row.profileId}` : `user-${row.userId}`, initialState: { columnVisibility: initialVisibility, pagination: { pageIndex: filters.page - 1, pageSize }, sorting: initialSorting }, pageCount: Math.max(1, Math.ceil(total / pageSize)), queryKeys: { filters: 'filters', joinOperator: 'joinOperator', page: 'page', perPage: 'pageSize', sort: 'sort' }, shallow: false });

  useEffect(() => setSearch(filters.q ?? ''), [filters.q]);
  useEffect(() => {
    table.setColumnVisibility(visibleState(new URLSearchParams(searchParams.toString()), initialVisibleColumns));
    table.resetRowSelection();
  }, [searchParams, initialVisibleColumns, table]);
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const preferences = {
      columns: OPTIONAL_COLUMNS.filter((column) => table.getState().columnVisibility[column] !== false),
      filters: params.get('filters') ?? undefined,
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
    void persistTablePreferences('memberships', { columns, filters: params.get('filters') ?? undefined, pageSize: state.pagination.pageSize, q: params.get('q') ?? undefined, sort: params.get('sort') ?? undefined, status: params.get('status') ?? undefined });
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [table.getState().columnVisibility]);

  const applySearch = () => { const params = new URLSearchParams(searchParams.toString()); search.trim() ? params.set('q', search.trim()) : params.delete('q'); params.delete('page'); router.push(`${pathname}?${params}`); };
  const reset = async () => { await fetch('/api/admin/table-preferences/memberships', { credentials: 'same-origin', headers: { 'x-idoc-csrf': decodeURIComponent(document.cookie.match(/(?:^|; )(?:__Host-)?idoc-csrf=([^;]+)/)?.[1] ?? '') }, method: 'DELETE' }); table.resetRowSelection(); router.push(`${pathname}?status=active`); };
  const exportParams = new URLSearchParams(searchParams.toString()); exportParams.delete('page'); exportParams.delete('profileId'); exportParams.delete('column');
  const selected = table.getSelectedRowModel().rows.length;
  const hasActiveView = [...searchParams.keys()].some((key) => !['column', 'page', 'pageSize', 'profileId'].includes(key));

  return <>
    <TablePreferenceSync table="memberships" />
    <DataTable table={table} emptyState={<div><strong>{hasActiveView ? 'No users match this view' : 'No users exist'}</strong><span className="mt-1 block text-muted-foreground">{hasActiveView ? 'Edit or clear filters to broaden the result set.' : 'Users appear here after account creation.'}</span></div>} actionBar={<ActionBar onOpenChange={(open) => { if (!open) table.resetRowSelection(); }} open={selected > 0}><ActionBarSelection>{selected} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}>
      <DataTableAdvancedToolbar table={table} className="mt-5 rounded-xl border bg-background p-3">
        <div className="flex min-w-64 flex-1 gap-2"><Input aria-label="Search member name or email" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }} placeholder="Search name or email…" type="search" value={search} /><Button onClick={applySearch} type="button">Search</Button></div>
        <DataTableFilterMenu table={table} debounceMs={debounceMs} shallow={shallow} throttleMs={throttleMs} />
        <DataTableFilterList table={table} debounceMs={debounceMs} shallow={shallow} throttleMs={throttleMs} />
        <DataTableSortList table={table} />
        <Button asChild size="sm" variant="outline"><Link download href={`/api/admin/export/members?${exportParams}`}><Download />Export filtered CSV</Link></Button>
        <Button onClick={reset} size="sm" type="button" variant="ghost">Reset to default</Button>
      </DataTableAdvancedToolbar>
      <p aria-live="polite" className="px-1 text-sm text-muted-foreground">{total} matching members</p>
    </DataTable>
  </>;
}
