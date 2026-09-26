'use client';

import type { ColumnDef, ColumnFiltersState, HeaderContext, VisibilityState } from '@tanstack/react-table';
import { Archive, CircleCheck, CircleX, Clock3, CreditCard, Download, FlaskConical, Gavel, Mail, Pencil, Shield, Stethoscope, UserCog, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
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
import { useActionBarVisibility } from '@/hooks/use-action-bar-visibility';
import { type DataTableLiveState, useDataTable } from '@/hooks/use-data-table';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import type { AdminMemberRow } from '@/lib/membership/admin-memberships';
import { COUNTRY_OPTIONS, countryNameForCode } from '@/lib/membership/countries';
import { IDOC_REGIONS } from '@/lib/membership/validation';

type Filters = {
  countries?: string[]; direction: 'asc' | 'desc'; expiresFrom?: string; expiresTo?: string; federations?: string[];
  membershipTypes?: string[]; page: number; q?: string; regions?: string[]; sort: string; statuses?: string[];
};

const OPTIONAL_COLUMNS = ['email', 'type', 'status', 'federation', 'country', 'region', 'expires', 'lastPayment', 'updated', 'actions'] as const;
const MULTI_SELECT_FILTERS = ['status', 'type', 'federation', 'country', 'region'] as const;
const COLUMN_LABELS: Record<string, string> = { actions: 'Actions', country: 'Country', email: 'Email', expires: 'Expiration', federation: 'National Federation', lastPayment: 'Last Payment', name: 'Member Name', region: 'IDOC Region', status: 'Status', type: 'Membership Type', updated: 'Updated' };
const STATUS_OPTIONS = [
  { label: 'Active Members', value: 'active' }, { label: 'Expired Members', value: 'expired' },
  { label: 'Archived Members', value: 'archived' },
  { label: 'Administrators', value: 'administrator' }, { label: 'Superadmins', value: 'super_admin' },
  { label: 'Onboarding Users', value: 'onboarding' }, { label: 'Test Members', value: 'test' },
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

function visibleState(initial?: string[]): VisibilityState {
  if (!initial) return {};
  return Object.fromEntries(OPTIONAL_COLUMNS.map((column) => [column, initial.includes(column)]));
}

function header(id: string) {
  return ({ column }: HeaderContext<AdminMemberRow, unknown>) => <DataTableColumnHeader column={column} label={COLUMN_LABELS[id] ?? id} />;
}

/** A column filter's react-table value is always an array here (every filterable column here is
 * `variant: 'multiSelect'`); comma-join it to match the persisted-preference/query-param shape
 * every server-side filter parser already accepts (see lib/admin/resource-list-query.ts's `many()`). */
function filterToken(columnFilters: ColumnFiltersState, id: string): string | undefined {
  const value = columnFilters.find((filter) => filter.id === id)?.value;
  const list = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return list.length ? list.join(',') : undefined;
}

export function MembersTable({ filters, initialColumnOrder, initialVisibleColumns, pageSize, rows, total }: { filters: Filters; initialColumnOrder?: string; initialVisibleColumns?: string[]; pageSize: number; rows: AdminMemberRow[]; total: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState(filters.q ?? '');
  const [expiresFrom, setExpiresFrom] = useState(filters.expiresFrom);
  const [expiresTo, setExpiresTo] = useState(filters.expiresTo);
  const [isPending, startTransition] = useTransition();
  const columns = useMemo<ColumnDef<AdminMemberRow>[]>(() => [
    { id: 'select', enableHiding: false, enableSorting: false, size: 40, header: ({ table }) => <Checkbox aria-label="Select all members on this page" checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')} onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))} />, cell: ({ row }) => <Checkbox aria-label={`Select ${row.original.firstName ?? row.original.email} ${row.original.lastName ?? ''}`} checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(Boolean(value))} /> },
    { id: 'name', accessorFn: (row) => `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(), header: header('name'), meta: { label: 'Member name' }, cell: ({ row }) => row.original.profileId ? <Link className="font-medium underline" href={`${pathname}?profileId=${row.original.profileId}`}>{row.original.firstName} {row.original.lastName}</Link> : <span className="text-muted-foreground">Profile not completed</span> },
    { id: 'email', accessorKey: 'email', header: header('email'), meta: { label: 'Email' }, cell: ({ row }) => <a className="underline" href={`mailto:${encodeURIComponent(row.original.email)}`}>{row.original.email}</a> },
    { id: 'type', accessorKey: 'membershipType', enableColumnFilter: true, header: header('type'), meta: { label: 'Membership Type', options: TYPE_OPTIONS, variant: 'multiSelect' }, cell: ({ row }) => { const type = TYPE_DISPLAY[row.original.membershipType as keyof typeof TYPE_DISPLAY]; return type ? <span className="inline-flex items-center gap-2"><type.icon aria-hidden="true" className="size-4 shrink-0" />{row.original.membershipType === 'combo' && <Shield aria-hidden="true" className="size-4 shrink-0" />}{type.label}</span> : '—'; } },
    { id: 'status', accessorKey: 'status', enableColumnFilter: true, header: header('status'), meta: { label: 'Member Status', options: STATUS_OPTIONS, variant: 'multiSelect' }, cell: ({ row }) => { const status = STATUS_DISPLAY[row.original.status as keyof typeof STATUS_DISPLAY]; return status ? <span className="inline-flex items-center gap-2"><status.icon aria-hidden="true" className="size-4 shrink-0" />{status.label}</span> : row.original.status.toUpperCase(); } },
    { id: 'federation', accessorKey: 'federation', enableColumnFilter: true, header: header('federation'), meta: { label: 'National Federation', options: COUNTRY_FILTER_OPTIONS, variant: 'multiSelect' }, cell: ({ row }) => row.original.federation ? countryNameForCode(row.original.federation) : '—' },
    { id: 'country', accessorKey: 'country', enableColumnFilter: true, header: header('country'), meta: { label: 'Address Country', options: COUNTRY_FILTER_OPTIONS, variant: 'multiSelect' }, cell: ({ row }) => row.original.country ? countryNameForCode(row.original.country) : '—' },
    { id: 'region', accessorKey: 'region', enableColumnFilter: true, header: header('region'), meta: { label: 'IDOC Region', options: REGION_FILTER_OPTIONS, variant: 'multiSelect' }, cell: ({ row }) => row.original.region ?? '—' },
    { id: 'expires', accessorKey: 'validUntil', header: header('expires'), meta: { label: 'Expiration Date' }, cell: ({ row }) => row.original.validUntil ? new Date(`${row.original.validUntil}T00:00:00`).toLocaleDateString() : '—' },
    { id: 'lastPayment', accessorKey: 'lastPaymentAt', header: header('lastPayment'), meta: { label: 'Last Payment' }, cell: ({ row }) => row.original.lastPaymentAt ? new Date(row.original.lastPaymentAt).toLocaleDateString() : '—' },
    { id: 'updated', accessorKey: 'updatedAt', header: header('updated'), meta: { label: 'Updated' }, cell: ({ row }) => new Date(row.original.updatedAt).toLocaleDateString() },
    { id: 'actions', enableHiding: true, enableSorting: false, size: 120, header: 'Actions', cell: ({ row }) => <div className="flex items-center gap-1">{row.original.profileId && <><Button asChild aria-label="Edit" size="icon-sm" title="Edit" variant="ghost"><Link href={`${pathname}?profileId=${row.original.profileId}`}><Pencil aria-hidden="true" /></Link></Button><Button asChild aria-label="Payment" size="icon-sm" title="Payment" variant="ghost"><Link href={`/admin/payments?profileId=${row.original.profileId}`}><CreditCard aria-hidden="true" /></Link></Button></>}<Button asChild aria-label="Email" size="icon-sm" title="Email" variant="ghost"><a href={`mailto:${encodeURIComponent(row.original.email)}`}><Mail aria-hidden="true" /></a></Button></div> },
  ], [pathname]);
  const initialSorting = filters.sort ? [{ desc: filters.direction === 'desc', id: filters.sort as keyof AdminMemberRow }] : [{ desc: false, id: 'name' as keyof AdminMemberRow }];
  // Facet filters (status/type/federation/country/region) are applied server-side from saved
  // preferences regardless of this initial state, so this must mirror what the server actually
  // applied -- otherwise the toolbar shows no active facets while the table is already filtered,
  // and the next unrelated change persists `undefined` for these, silently clearing the saved view.
  const initialColumnFilters: ColumnFiltersState = [
    { id: 'type', value: filters.membershipTypes ?? [] },
    { id: 'status', value: filters.statuses ?? [] },
    { id: 'federation', value: filters.federations ?? [] },
    { id: 'country', value: filters.countries ?? [] },
    { id: 'region', value: filters.regions ?? [] },
  ].filter((filter) => filter.value.length > 0);

  // Persists to the database and refetches via a same-URL router.refresh() -- deliberately never
  // writes any of this to the URL. `overrides` lets a single caller (e.g. Reset) atomically change
  // several pieces of state that don't all live in the same place (search text, date range, table
  // state) without racing multiple separate persist calls against each other.
  function persistAndRefresh(state: DataTableLiveState, overrides?: { expiresFrom?: string; expiresTo?: string; q?: string }) {
    const effectiveSearch = overrides && 'q' in overrides ? overrides.q : search;
    const effectiveFrom = overrides && 'expiresFrom' in overrides ? overrides.expiresFrom : expiresFrom;
    const effectiveTo = overrides && 'expiresTo' in overrides ? overrides.expiresTo : expiresTo;
    const columns = OPTIONAL_COLUMNS.filter((column) => table.getState().columnVisibility[column] !== false);
    void persistTablePreferences('memberships', {
      columnOrder: table.getState().columnOrder.join(','),
      columns,
      country: filterToken(state.columnFilters, 'country'),
      expiresFrom: effectiveFrom,
      expiresTo: effectiveTo,
      federation: filterToken(state.columnFilters, 'federation'),
      page: state.pagination.pageIndex + 1,
      pageSize: state.pagination.pageSize,
      q: effectiveSearch || undefined,
      region: filterToken(state.columnFilters, 'region'),
      sort: state.sorting.length ? JSON.stringify(state.sorting) : undefined,
      status: filterToken(state.columnFilters, 'status'),
      type: filterToken(state.columnFilters, 'type'),
    }).finally(() => startTransition(() => router.refresh()));
  }

  const { table } = useDataTable({
    columns, data: rows,
    enableAdvancedFilter: false,
    getRowId: (row) => row.profileId ? `profile-${row.profileId}` : `user-${row.userId}`,
    initialState: { columnFilters: initialColumnFilters, columnOrder: initialColumnOrder?.split(','), columnVisibility: visibleState(initialVisibleColumns), pagination: { pageIndex: filters.page - 1, pageSize }, sorting: initialSorting },
    onLiveStateChange: (state) => persistAndRefresh(state),
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    startTransition,
  });

  // Column visibility/order changes aren't covered by onStateChange above (that only fires for
  // pagination/sorting/columnFilters), so persist them here on their own change, immediately --
  // a deliberate one-off click, not something to debounce.
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
    setExpiresFrom(undefined);
    setExpiresTo(undefined);
    setDateResetSignal((signal) => signal + 1);
    table.resetColumnFilters();
    persistAndRefresh(
      { columnFilters: [], pagination: table.getState().pagination, sorting: table.getState().sorting },
      { expiresFrom: undefined, expiresTo: undefined, q: undefined },
    );
  }

  // A manual filter change (search, date range) must return to page 1 -- otherwise staying on
  // page N of a now-narrower result set can show an empty table, or even "Page N of 1".
  const debouncedSearchPersist = useDebouncedCallback((value: string) => {
    persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: { ...table.getState().pagination, pageIndex: 0 }, sorting: table.getState().sorting }, { q: value });
  }, 300);

  /** Built fresh at click time from current state -- a query string on a one-off GET download
   * link is exactly the short-lived, single-step use of URL params this app still uses; it never
   * touches the browser's address bar. */
  function currentExportParams() {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (expiresFrom) params.set('expiresFrom', expiresFrom);
    if (expiresTo) params.set('expiresTo', expiresTo);
    for (const key of MULTI_SELECT_FILTERS) {
      const value = filterToken(table.getState().columnFilters, key);
      if (value) params.set(key, value);
    }
    const sorting = table.getState().sorting;
    if (sorting.length) params.set('sort', JSON.stringify(sorting));
    return params;
  }

  const exportParams = currentExportParams();
  const selected = table.getSelectedRowModel().rows.length;
  const actionBarVisibility = useActionBarVisibility(selected);
  const selectedExportParams = new URLSearchParams(exportParams.toString());
  for (const row of table.getSelectedRowModel().rows) selectedExportParams.append('selectedUserId', String(row.original.userId));
  const [dateDraftActive, setDateDraftActive] = useState(false);
  const [dateResetSignal, setDateResetSignal] = useState(0);
  const manuallyFiltered = Boolean(expiresFrom || expiresTo) || dateDraftActive;
  const hasActiveView = Boolean(search) || Boolean(expiresFrom) || Boolean(expiresTo) || table.getState().columnFilters.length > 0;

  return <>
    <TablePreferenceSync table="memberships" />
    <DataTable table={table} pageSizeOptions={[10, 25, 50, 100]} loading={isPending} emptyState={<div><strong>{hasActiveView ? 'No users match this view' : 'No users exist'}</strong><span className="mt-1 block text-muted-foreground">{hasActiveView ? 'Edit or clear filters to broaden the result set.' : 'Users appear here after account creation.'}</span></div>} actionBar={<ActionBar onOpenChange={actionBarVisibility.onOpenChange} open={actionBarVisibility.open}><ActionBarSelection>{selected} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={() => { const anchor = document.createElement('a'); anchor.href = `/api/admin/export/members?${selectedExportParams}`; anchor.download = 'selected-members.csv'; anchor.click(); }}>Export selected CSV</ActionBarItem><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}>
      <DataTableToolbar
        className="mt-5 rounded-xl border bg-background p-3"
        table={table}
        isFiltered={manuallyFiltered}
        pending={isPending}
        onReset={resetAll}
        leading={<>
          <Input aria-label="Search member name or email" className="h-8 w-40 lg:w-56" onChange={(event) => { setSearch(event.target.value); table.setPageIndex(0); debouncedSearchPersist(event.target.value); }} placeholder="Search name or email…" type="search" value={search} />
          <DateRangeFilter from={expiresFrom} label="Expires" onChange={(from, to) => { setExpiresFrom(from); setExpiresTo(to); table.setPageIndex(0); persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: { ...table.getState().pagination, pageIndex: 0 }, sorting: table.getState().sorting }, { expiresFrom: from, expiresTo: to }); }} onDraftActiveChange={setDateDraftActive} resetSignal={dateResetSignal} to={expiresTo} />
        </>}
        trailing={<Button asChild aria-label="Download These results" data-idoc-table-control size="icon-sm" variant="outline"><Link aria-label="Download These results" download href={`/api/admin/export/members?${exportParams}`} title="Download These results"><Download aria-hidden="true" /></Link></Button>}
      >
        <DataTableSortList table={table} />
      </DataTableToolbar>
      <p aria-live="polite" className="px-1 text-sm text-muted-foreground">{total} matching members</p>
    </DataTable>
  </>;
}
