'use client';

import type { ColumnDef, ColumnFiltersState, HeaderContext } from '@tanstack/react-table';
import { Download, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { BulkDeleteSelected } from '@/components/admin/bulk-delete-selected';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { persistTablePreferences, TablePreferenceSync } from '@/components/admin/table-preference-sync';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader, DataTableStaticHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableActionsRow } from '@/components/data-table/data-table-actions-row';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection } from '@/components/ui/action-bar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useActionBarVisibility } from '@/hooks/use-action-bar-visibility';
import { type DataTableLiveState, useDataTable } from '@/hooks/use-data-table';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import { PAYMENT_STATUS_LABELS, PAYMENT_STATUSES, type PaymentStatus, registrationDisplayLabel } from '@/lib/seminars/status';
import { PaymentMethodIcon, PaymentStatusIcon, paymentMethodLabel } from '@/components/seminars/payment-method-icon';

type AdminRegistrationRow = {
  canceled_at: Date | string | null; currency: string; expected_amount_cents: number | null; id: number; is_guest: boolean;
  paid_at: Date | string | null; payment_method_canonical_id: string; payment_status: string; registered_at: Date | string;
  registrant_email: string; registrant_name: string; registration_status: 'canceled' | 'registered'; seminar_id: number; seminar_title: string;
};

const OPTIONAL_COLUMNS = ['registrant', 'seminar', 'status', 'registered'] as const;
const LABELS: Record<string, string> = { registered: 'Registered', registrant: 'Registrant', seminar: 'Seminar', status: 'Payment Status' };
const PAYMENT_STATUS_OPTIONS = PAYMENT_STATUSES.map((value) => ({ label: PAYMENT_STATUS_LABELS[value], value }));
function header(id: string) { return ({ column }: HeaderContext<AdminRegistrationRow, unknown>) => <DataTableColumnHeader column={column} label={LABELS[id]} />; }
function filterToken(columnFilters: ColumnFiltersState, id: string): string | undefined {
  const value = columnFilters.find((filter) => filter.id === id)?.value;
  const list = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return list.length ? list.join(',') : undefined;
}

export function RegistrationsTable({
  filters, initialColumnOrder, initialVisibleColumns, rows, seminarOptions, total,
}: {
  filters: { from?: string; page: number; pageSize: number; paymentStatus?: string; q?: string; seminarId?: string; sort?: string; to?: string };
  initialColumnOrder?: string; initialVisibleColumns?: string[]; rows: AdminRegistrationRow[];
  seminarOptions: { label: string; value: string }[]; total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(filters.q ?? '');
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [isPending, startTransition] = useTransition();
  const openTableAction = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    startTransition(() => router.push(href));
  }, [router]);
  const initialVisibility = useMemo(() => {
    if (!initialVisibleColumns) return {};
    return Object.fromEntries(OPTIONAL_COLUMNS.map((column) => [column, initialVisibleColumns.includes(column)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount.
  }, []);
  const columns = useMemo<ColumnDef<AdminRegistrationRow>[]>(() => [
    { id: 'select', enableHiding: false, enableSorting: false, size: 40, header: ({ table }) => <Checkbox aria-label="Select all registrations on this page" checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')} onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))} />, cell: ({ row }) => <Checkbox aria-label={`Select ${row.original.registrant_name}`} checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(Boolean(value))} /> },
    { id: 'registrant', accessorFn: (row) => `${row.registrant_name} ${row.registrant_email}`, header: header('registrant'), meta: { label: 'Registrant' }, cell: ({ row }) => <div>{row.original.registrant_name}{row.original.is_guest ? <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Guest</span> : null}<span className="block text-sm text-muted-foreground">{row.original.registrant_email}</span></div> },
    { id: 'seminar', accessorKey: 'seminar_title', enableColumnFilter: true, header: header('seminar'), meta: { label: 'Seminar', options: seminarOptions, variant: 'multiSelect' }, cell: ({ row }) => <span className="font-medium">{row.original.seminar_title}</span> },
    { id: 'status', accessorKey: 'payment_status', enableColumnFilter: true, header: header('status'), meta: { label: 'Payment Status', options: PAYMENT_STATUS_OPTIONS, variant: 'multiSelect' }, cell: ({ row }) => <div><span className="inline-flex items-center gap-2 font-medium"><PaymentStatusIcon status={row.original.payment_status} />{registrationDisplayLabel(row.original.registration_status, row.original.payment_status as PaymentStatus).toUpperCase()}</span><span className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><PaymentMethodIcon method={row.original.payment_method_canonical_id} />{paymentMethodLabel(row.original.payment_method_canonical_id)}</span></div> },
    { id: 'registered', accessorKey: 'registered_at', header: header('registered'), meta: { label: 'Registered' }, cell: ({ row }) => new Date(row.original.registered_at).toLocaleString() },
    {
      id: 'actions', enableHiding: false, enableSorting: false, size: 90,
      header: () => <DataTableStaticHeader className="text-gold" label="Actions" />,
      meta: { label: 'Actions' },
      cell: ({ row }) => <Button asChild aria-label="Edit registration" size="icon-sm" title="Edit registration" variant="ghost">
        <Link href={`${pathname}?registrationId=${row.original.id}`} onClick={(event) => openTableAction(event, `${pathname}?registrationId=${row.original.id}`)}><Pencil aria-hidden="true" /></Link>
      </Button>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seminarOptions is derived server-side per render, stable for this table's lifetime.
  ], [openTableAction, pathname, seminarOptions]);
  const defaultColumnOrder = ['select', 'registered', 'registrant', 'seminar', 'status', 'actions'];
  const initialSorting = useMemo(() => {
    try { const parsed = JSON.parse(filters.sort ?? '[]'); if (Array.isArray(parsed) && parsed.length) return parsed; } catch { /* fall through to the default below */ }
    return [{ desc: true, id: 'registered' as keyof AdminRegistrationRow }];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount.
  }, []);
  // Facet filters are applied server-side from saved preferences regardless of this initial
  // state, so this must mirror what the server actually applied -- otherwise the toolbar shows no
  // active facets while the table is already filtered, and the next unrelated change persists
  // `undefined` for these, silently clearing the saved view.
  const initialColumnFilters = useMemo(() => [
    { id: 'seminar', value: filters.seminarId ? filters.seminarId.split(',') : [] },
    { id: 'status', value: filters.paymentStatus ? filters.paymentStatus.split(',') : [] },
  ].filter((filter) => filter.value.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount.
    []);

  function persistAndRefresh(state: DataTableLiveState, overrides?: { from?: string; q?: string; to?: string }) {
    const effectiveSearch = overrides && 'q' in overrides ? overrides.q : search;
    const effectiveFrom = overrides && 'from' in overrides ? overrides.from : from;
    const effectiveTo = overrides && 'to' in overrides ? overrides.to : to;
    void persistTablePreferences('seminar_registrations', {
      columnOrder: table.getState().columnOrder.join(','),
      columns: OPTIONAL_COLUMNS.filter((column) => table.getState().columnVisibility[column] !== false),
      from: effectiveFrom,
      page: state.pagination.pageIndex + 1,
      pageSize: state.pagination.pageSize,
      paymentStatus: filterToken(state.columnFilters, 'status'),
      q: effectiveSearch || undefined,
      seminarId: filterToken(state.columnFilters, 'seminar'),
      sort: state.sorting.length ? JSON.stringify(state.sorting) : undefined,
      to: effectiveTo,
      // Dropping the transient `seminarId` query param the moment the admin makes their first
      // change here matches app/(dashboard)/admin/support/page.tsx's `memberEmail` shortcut --
      // otherwise a later router.refresh() on the same URL could re-apply the original seminar
      // filter forever.
    }).finally(() => startTransition(() => router.replace(pathname)));
  }

  const { table } = useDataTable({
    columns, data: rows,
    enableAdvancedFilter: false,
    getRowId: (row) => String(row.id),
    initialState: { columnFilters: initialColumnFilters, columnOrder: initialColumnOrder?.split(',') ?? defaultColumnOrder, columnVisibility: initialVisibility, pagination: { pageIndex: filters.page - 1, pageSize: filters.pageSize }, sorting: initialSorting },
    onLiveStateChange: (state) => persistAndRefresh(state),
    pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
    startTransition,
  });

  const skipNextColumnPersist = useRef(true);
  const visibilityKey = JSON.stringify(table.getState().columnVisibility);
  const orderKey = table.getState().columnOrder.join(',');
  useEffect(() => {
    if (skipNextColumnPersist.current) { skipNextColumnPersist.current = false; return; }
    persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: table.getState().pagination, sorting: table.getState().sorting });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires exactly when visibility/order change, reading everything else fresh at call time.
  }, [visibilityKey, orderKey]);

  function resetAll() {
    setSearch('');
    setFrom(undefined);
    setTo(undefined);
    setDateResetSignal((signal) => signal + 1);
    table.resetColumnFilters(true);
    persistAndRefresh(
      { columnFilters: [], pagination: table.getState().pagination, sorting: table.getState().sorting },
      { from: undefined, q: undefined, to: undefined },
    );
  }

  const debouncedSearchPersist = useDebouncedCallback((value: string) => {
    persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: { ...table.getState().pagination, pageIndex: 0 }, sorting: table.getState().sorting }, { q: value });
  }, 300);

  function currentExportParams() {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const seminarId = filterToken(table.getState().columnFilters, 'seminar');
    if (seminarId) params.set('seminarId', seminarId);
    const paymentStatus = filterToken(table.getState().columnFilters, 'status');
    if (paymentStatus) params.set('paymentStatus', paymentStatus);
    return params;
  }
  const exportParams = currentExportParams();

  const selectedRows = table.getSelectedRowModel().rows;
  const actionBarVisibility = useActionBarVisibility(selectedRows.length);
  const [dateDraftActive, setDateDraftActive] = useState(false);
  const [dateResetSignal, setDateResetSignal] = useState(0);
  const manuallyFiltered = Boolean(from || to) || dateDraftActive;
  const filtered = manuallyFiltered || Boolean(search) || table.getState().columnFilters.length > 0;
  return <><TablePreferenceSync table="seminar_registrations" /><DataTable
    actionBar={<ActionBar open={actionBarVisibility.open} onOpenChange={actionBarVisibility.onOpenChange}><ActionBarSelection>{selectedRows.length} selected</ActionBarSelection><ActionBarGroup><BulkDeleteSelected clearSelection={() => table.resetRowSelection()} ids={selectedRows.map((row) => String(row.original.id))} table="registrations" /><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}
    emptyState={<div><strong>{filtered ? 'No registrations match this view' : 'No seminar registrations exist'}</strong><span className="mt-1 block text-muted-foreground">{filtered ? 'Edit or clear filters to broaden the result set.' : 'Registrations appear here once members or guests sign up.'}</span></div>}
    loading={isPending} pageSizeOptions={[10, 25, 50, 100]} table={table}
  >
    <DataTableToolbar
      className="rounded-xl border bg-background p-3"
      table={table}
      isFiltered={manuallyFiltered}
      pending={isPending}
      onReset={resetAll}
      leading={<>
        <Input aria-label="Search name or email" className="h-8 w-40 lg:w-56" onChange={(event) => { setSearch(event.target.value); table.setPageIndex(0); debouncedSearchPersist(event.target.value); }} placeholder="Search name or email…" type="search" value={search} />
        <DateRangeFilter from={from} label="Registered" onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); table.setPageIndex(0); persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: { ...table.getState().pagination, pageIndex: 0 }, sorting: table.getState().sorting }, { from: nextFrom, to: nextTo }); }} onDraftActiveChange={setDateDraftActive} resetSignal={dateResetSignal} to={to} />
      </>}
    />
    <DataTableActionsRow count={total + ' matching registrations'} table={table} trailing={<Button asChild aria-label="Download these results" data-idoc-table-control size="icon-sm" variant="outline"><Link aria-label="Download these results" download href={`/api/admin/export/seminar-all-registrations?${exportParams}`} title="Download this seminar's registrations"><Download aria-hidden="true" /></Link></Button>}>
      <DataTableSortList table={table} />
    </DataTableActionsRow>
  </DataTable></>;
}
