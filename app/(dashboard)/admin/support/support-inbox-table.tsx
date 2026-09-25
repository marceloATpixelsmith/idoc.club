'use client';

import type { ColumnDef, HeaderContext, VisibilityState } from '@tanstack/react-table';
import { X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { manyParam, persistTablePreferences, TablePreferenceSync } from '@/components/admin/table-preference-sync';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection } from '@/components/ui/action-bar';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useActionBarVisibility } from '@/hooks/use-action-bar-visibility';
import { useCanonicalizeMultiSelectParams } from '@/hooks/use-canonicalize-multi-select-params';
import { useDataTable } from '@/hooks/use-data-table';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import { CATEGORY_LABELS, STATUS_LABELS, SUPPORT_CATEGORIES, SUPPORT_STATUSES, type SupportCategory } from '@/lib/support/inbox-options';

type AdminSupportRow = { assignee_name: string; category: SupportCategory; member_email: string; member_name: string; profile_id: number | null; public_id: string; status: string; subject: string; total_count: number; unread: boolean; updated_at: Date; };

const OPTIONAL_COLUMNS = ['member', 'subject', 'category', 'status', 'assigned', 'activity'] as const;
const MULTI_SELECT_PARAMS = ['category', 'status', 'assigned'] as const;
const LABELS: Record<string, string> = { activity: 'Activity', assigned: 'Assigned', category: 'Category', member: 'Member', status: 'Status', subject: 'Subject' };
const CATEGORY_OPTIONS = SUPPORT_CATEGORIES.map((value) => ({ label: CATEGORY_LABELS[value], value }));
const STATUS_OPTIONS = SUPPORT_STATUSES.map((value) => ({ label: STATUS_LABELS[value], value }));
function visibility(params: URLSearchParams, initial?: string[]): VisibilityState { const explicit = params.getAll('column'); const selected = explicit.length ? explicit : initial; return selected ? Object.fromEntries(OPTIONAL_COLUMNS.map((column) => [column, selected.includes(column)])) : {}; }
function header(id: string) { return ({ column }: HeaderContext<AdminSupportRow, unknown>) => <DataTableColumnHeader column={column} label={LABELS[id]} />; }

export function SupportInboxTable({ administrators, filters, initialVisibleColumns, rows, total }: { administrators: { label: string; value: string }[]; filters: { page: number; pageSize: number; q?: string; category?: string | string[]; status?: string | string[]; assigned?: string | string[]; activityFrom?: string | string[]; activityTo?: string | string[]; filters?: string | string[]; joinOperator?: string | string[]; sort?: string | string[]; direction?: string | string[] }; initialVisibleColumns?: string[]; rows: AdminSupportRow[]; total: number }) {
  const pathname = usePathname(); const router = useRouter(); const searchParams = useSearchParams(); useCanonicalizeMultiSelectParams(MULTI_SELECT_PARAMS); const [search, setSearch] = useState(filters.q ?? ''); const [copyNotice, setCopyNotice] = useState(''); const suppressPersistence = useRef(false); const [isPending, startTransition] = useTransition();
  const initialVisibility = useMemo(() => visibility(new URLSearchParams(searchParams.toString()), initialVisibleColumns), []);
  const activityFrom = Array.isArray(filters.activityFrom) ? filters.activityFrom[0] : filters.activityFrom;
  const activityTo = Array.isArray(filters.activityTo) ? filters.activityTo[0] : filters.activityTo;
  const columns = useMemo<ColumnDef<AdminSupportRow>[]>(() => [
    { id: 'select', enableHiding: false, enableSorting: false, size: 40, header: ({ table }) => <Checkbox aria-label="Select all support conversations on this page" checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')} onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))} />, cell: ({ row }) => <Checkbox aria-label={`Select ${row.original.subject}`} checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(Boolean(value))} /> },
    { id: 'member', accessorFn: (row) => `${row.member_name} ${row.member_email}`, header: header('member'), meta: { label: 'Member' }, cell: ({ row }) => <div>{row.original.profile_id ? <Link className="font-medium underline" href={`/admin/members?profileId=${row.original.profile_id}`}>{row.original.member_name || 'Member record'}</Link> : row.original.member_name}<span className="block text-sm text-muted-foreground">{row.original.member_email}</span></div> },
    { id: 'subject', accessorKey: 'subject', header: header('subject'), meta: { label: 'Subject' }, cell: ({ row }) => { const current = `/admin/support?${searchParams}`; return <Link className="font-medium underline" href={`/admin/support/${row.original.public_id}?returnTo=${encodeURIComponent(current)}`}>{row.original.subject}{row.original.unread ? ' · New' : ''}</Link>; } },
    { id: 'category', accessorKey: 'category', enableColumnFilter: true, header: header('category'), meta: { label: 'Category', options: CATEGORY_OPTIONS, variant: 'multiSelect' }, cell: ({ row }) => CATEGORY_LABELS[row.original.category] },
    { id: 'status', accessorKey: 'status', enableColumnFilter: true, header: header('status'), meta: { label: 'Status', options: STATUS_OPTIONS, variant: 'multiSelect' }, cell: ({ row }) => STATUS_LABELS[row.original.status] },
    { id: 'assigned', accessorKey: 'assignee_name', enableColumnFilter: true, header: header('assigned'), meta: { label: 'Assigned Administrator', options: [{ label: 'Unassigned', value: 'unassigned' }, ...administrators], variant: 'multiSelect' }, cell: ({ row }) => row.original.assignee_name || 'Unassigned' },
    { id: 'activity', accessorKey: 'updated_at', header: header('activity'), meta: { label: 'Activity Date' }, cell: ({ row }) => new Date(row.original.updated_at).toLocaleString() },
  ], [administrators, searchParams]);
  let initialSorting = [{ desc: true, id: 'activity' as keyof AdminSupportRow }];
  try { const parsed = JSON.parse(searchParams.get('sort') ?? '[]'); if (Array.isArray(parsed) && parsed.length) initialSorting = parsed; } catch { /* The server safely applies legacy/default sorting. */ }
  const { table } = useDataTable({
    columns, data: rows,
    // Simple (non-advanced) mode is required for the auto-rendered category/status/assigned
    // faceted filters below to sync through `column.setFilterValue` -- advanced mode no-ops that path.
    enableAdvancedFilter: false,
    getRowId: (row) => row.public_id,
    initialState: { columnVisibility: initialVisibility, pagination: { pageIndex: filters.page - 1, pageSize: filters.pageSize }, sorting: initialSorting },
    pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
    queryKeys: { page: 'page', perPage: 'pageSize', sort: 'sort' },
    shallow: false,
    startTransition,
  });
  function filterPreferenceFields(params: URLSearchParams) {
    return {
      activityFrom: params.get('activityFrom') ?? undefined,
      activityTo: params.get('activityTo') ?? undefined,
      assigned: manyParam(params, 'assigned'),
      category: manyParam(params, 'category'),
      q: params.get('q') ?? undefined,
      sort: params.get('sort') ?? undefined,
      status: manyParam(params, 'status'),
    };
  }

  useEffect(() => setSearch(filters.q ?? ''), [filters.q]);
  useEffect(() => { table.resetRowSelection(); }, [searchParams, table]);
  useEffect(() => { if (suppressPersistence.current || sessionStorage.getItem('support-preferences-reset') === '1') { suppressPersistence.current = false; sessionStorage.removeItem('support-preferences-reset'); return; } const state = table.getState(); const selected = OPTIONAL_COLUMNS.filter((column) => state.columnVisibility[column] !== false); const params = new URLSearchParams(searchParams.toString()); const current = params.getAll('column'); if (current.length === selected.length && current.every((value, index) => value === selected[index])) return; params.delete('column'); for (const column of selected) params.append('column', column); void persistTablePreferences('support', { ...filterPreferenceFields(params), columns: selected, pageSize: state.pagination.pageSize }); router.replace(`${pathname}?${params}`, { scroll: false }); }, [table.getState().columnVisibility]);
  useEffect(() => { if (suppressPersistence.current || sessionStorage.getItem('support-preferences-reset') === '1') return; const params = new URLSearchParams(searchParams.toString()); void persistTablePreferences('support', { ...filterPreferenceFields(params), columns: OPTIONAL_COLUMNS.filter((column) => table.getState().columnVisibility[column] !== false), columnOrder: params.get('columnOrder') ?? undefined, pageSize: Number(params.get('pageSize') ?? filters.pageSize) }); }, [filters.pageSize, searchParams, table]);
  // Purging 'filters'/'joinOperator' here (the retired advanced filter-builder's params) keeps
  // a stale/shared URL carrying them from silently narrowing results the current toolbar shows
  // no indication of.
  function update(values: Record<string, string | undefined>) { const params = new URLSearchParams(searchParams.toString()); params.delete('filters'); params.delete('joinOperator'); for (const [key, value] of Object.entries(values)) { if (value) params.set(key, value); else params.delete(key); } params.delete('page'); startTransition(() => router.push(`${pathname}?${params}`)); }
  const debouncedSearch = useDebouncedCallback((value: string) => update({ q: value || undefined }), 300);
  async function copySelectedLinks() {
    try {
      await navigator.clipboard.writeText(table.getSelectedRowModel().rows.map(({ original }) => `${window.location.origin}/admin/support/${original.public_id}`).join('\n'));
      setCopyNotice('Selected links copied.');
    } catch { setCopyNotice('Could not copy the selected links.'); }
  }
  const selected = table.getSelectedRowModel().rows.length;
  const actionBarVisibility = useActionBarVisibility(selected);
  // `manuallyFiltered` drives the Reset button's visibility, so it deliberately excludes `q`
  // (search) -- the search box has its own clear affordance. `filtered` drives the empty-state
  // copy, so it must include `q`: a search that matches nothing is still "no conversations match
  // this view", not "no support conversations exist at all".
  const manuallyFiltered = Boolean(searchParams.get('activityFrom') || searchParams.get('activityTo'));
  const filtered = manuallyFiltered || Boolean(searchParams.get('q') || searchParams.get('category') || searchParams.get('status') || searchParams.get('assigned'));
  return <><TablePreferenceSync table="support" /><DataTable actionBar={<ActionBar onOpenChange={actionBarVisibility.onOpenChange} open={actionBarVisibility.open}><ActionBarSelection>{selected} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={() => void copySelectedLinks()}>Copy selected links</ActionBarItem><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>} emptyState={<div><strong>{filtered ? 'No conversations match this view' : 'No support conversations exist'}</strong><span className="mt-1 block text-muted-foreground">{filtered ? 'Edit or clear filters to broaden the queue.' : 'New member conversations will appear here.'}</span></div>} loading={isPending} pageSizeOptions={[10, 25, 50, 100]} table={table}>
    <DataTableToolbar
      className="rounded-xl border bg-background p-3"
      table={table}
      isFiltered={manuallyFiltered}
      pending={isPending}
      onReset={() => update({ activityFrom: undefined, activityTo: undefined, q: undefined })}
      leading={<>
        <Input aria-label="Search support conversations" className="h-8 w-40 lg:w-56" onChange={(event) => { setSearch(event.target.value); debouncedSearch(event.target.value); }} placeholder="Search member, email, or subject…" type="search" value={search} />
        <DateRangeFilter from={activityFrom} label="Activity" onChange={(nextFrom, nextTo) => update({ activityFrom: nextFrom, activityTo: nextTo })} to={activityTo} />
      </>}
    >
      <DataTableSortList table={table} />
    </DataTableToolbar>
    <p aria-live="polite" className="px-1 text-sm text-muted-foreground">{total} matching conversations</p>{copyNotice && <p aria-live="polite" className="px-1 text-sm">{copyNotice}</p>}</DataTable></>;
}
