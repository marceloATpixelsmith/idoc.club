'use client';

import type { ColumnDef, ColumnFiltersState, HeaderContext } from '@tanstack/react-table';
import { Archive, BookOpenText, CircleAlert, CircleCheck, CircleDashed, ClipboardList, Clock3, Download, LoaderCircle, Newspaper, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { updateAdminTableInlineField } from '@/app/(dashboard)/admin/bulk-actions';
import { BulkDeleteSelected } from '@/components/admin/bulk-delete-selected';
import { BulkNewsStatusSelected } from '@/components/admin/bulk-update-selected';
import { persistTablePreferences, TablePreferenceSync } from '@/components/admin/table-preference-sync';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { downloadCsv } from '@/components/admin/download-csv';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableActionsRow } from '@/components/data-table/data-table-actions-row';
import { DataTableColumnHeader, DataTableStaticHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection } from '@/components/ui/action-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useActionBarVisibility } from '@/hooks/use-action-bar-visibility';
import { type DataTableLiveState, useDataTable } from '@/hooks/use-data-table';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import type { AdminTableIdentifier, TablePreferenceState } from '@/lib/admin/table-preferences';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';

export type ResourceRow = {
  id: number;
  access?: string[];
  title: string;
  status: string;
  subtitle?: string;
  slug?: string;
  type?: string;
  thumbnailUrl?: string;
  publication?: string;
  updated?: string;
  date?: string;
  start?: string;
  end?: string;
  deadline?: string;
  prices?: string;
  registrations?: string;
};

type ResourceType = 'news' | 'seminars';
type ResourceColumn = keyof ResourceRow;
type ResourceConfig = {
  columns: { id: ResourceColumn; label: string }[];
  dateFilter: boolean;
  path: string;
  searchLabel: string;
  statuses: { label: string; value: string }[];
  types?: { label: string; value: string }[];
};

const CONFIG: Record<ResourceType, ResourceConfig> = {
  news: {
    columns: [{ id: 'title', label: 'Title' }, { id: 'type', label: 'Article Type' }, { id: 'status', label: 'Status' }, { id: 'access', label: 'Access' }, { id: 'publication', label: 'Publication Date' }, { id: 'updated', label: 'Updated' }],
    dateFilter: true,
    path: '/admin/news',
    searchLabel: 'Search article title, subtitle, or slug',
    statuses: [{ label: 'Draft', value: 'draft' }, { label: 'Scheduled', value: 'scheduled' }, { label: 'Published', value: 'published' }, { label: 'Archived', value: 'archived' }],
    types: [{ label: 'NEWS', value: 'news' }, { label: 'BLOG', value: 'blog' }],
  },
  seminars: {
    columns: [{ id: 'title', label: 'Title' }, { id: 'status', label: 'Status' }, { id: 'start', label: 'Start' }, { id: 'end', label: 'End' }, { id: 'deadline', label: 'Deadline' }, { id: 'prices', label: 'Prices' }, { id: 'registrations', label: 'Registered / Capacity' }],
    dateFilter: true,
    path: '/admin/seminars',
    searchLabel: 'Search seminar title or location',
    statuses: [{ label: 'Draft', value: 'draft' }, { label: 'Published', value: 'published' }, { label: 'Canceled', value: 'canceled' }],
  },
};

const ACCESS_LABELS: Record<string, string> = {
  judge: 'Judge',
  members: 'All Members',
  public: 'Public',
  steward: 'Steward',
  veterinarian: 'Veterinarian',
};

function statusIcon(tableType: ResourceType, status: string) {
  if (tableType === 'seminars') return status === 'published' ? CircleCheck : status === 'canceled' ? CircleAlert : CircleDashed;
  return status === 'published' ? CircleCheck : status === 'scheduled' ? Clock3 : status === 'archived' ? Archive : CircleDashed;
}

function InlineStatusEditor({ id, status, tableType }: { id: number; status: string; tableType: ResourceType }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [pending, startTransition] = useTransition();
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const saving = pending || savingTarget !== null;
  useEffect(() => {
    if (savingTarget !== null && status === savingTarget) setSavingTarget(null);
  }, [savingTarget, status]);
  const Icon = statusIcon(tableType, value);
  const options = CONFIG[tableType].statuses;

  function changeStatus(next: string) {
    if (next === value || saving) return;
    const previous = value;
    setValue(next);
    setSavingTarget(next);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('csrf_token', readCsrfTokenFromDocumentCookie());
      formData.set('table', tableType);
      formData.set('id', String(id));
      formData.set('field', 'status');
      formData.set('status', next);
      try {
        const result = await updateAdminTableInlineField({}, formData);
        if (result.error) {
          setValue(previous);
          setSavingTarget(null);
          window.alert(result.error);
          return;
        }
        router.refresh();
      } catch {
        setValue(previous);
        setSavingTarget(null);
        window.alert('Unable to save this status change. Please try again.');
      }
    });
  }

  return (
    <div aria-busy={saving || undefined} className="relative inline-flex h-8 items-center gap-2 font-medium">
      <span className="flex size-4 shrink-0 items-center justify-center self-center">
        {saving ? <LoaderCircle aria-label="Updating status" className="size-4 animate-spin text-gold" /> : <Icon aria-hidden className="size-4" />}
      </span>
      <select
        aria-label={`Change ${tableType === 'seminars' ? 'seminar' : 'News/Blog'} status`}
        className="idoc-inline-status-select h-8 cursor-pointer appearance-none border-0 bg-transparent py-0 pr-0 font-medium leading-8 uppercase outline-none disabled:cursor-wait disabled:opacity-60"
        disabled={saving}
        onChange={(event) => changeStatus(event.target.value)}
        value={value}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

const ACCESS_OPTIONS = [
  { label: 'Public', value: 'public' },
  { label: 'All logged-in Members', value: 'members' },
  { label: 'Judge', value: 'judge' },
  { label: 'Steward', value: 'steward' },
  { label: 'Veterinarian', value: 'veterinarian' },
] as const;

function InlineAccessEditor({ access, id }: { access?: string[]; id: number }) {
  const router = useRouter();
  const initial = access?.length ? access : ['public'];
  const [selected, setSelected] = useState<string[]>(initial);
  const [pending, startTransition] = useTransition();
  const [savingTarget, setSavingTarget] = useState<string[] | null>(null);
  const saving = pending || savingTarget !== null;
  const actualAccess = access?.length ? access : ['public'];
  useEffect(() => {
    if (savingTarget !== null && savingTarget.length === actualAccess.length && savingTarget.every((item) => actualAccess.includes(item))) {
      setSavingTarget(null);
    }
  }, [access, savingTarget]);

  function nextAudience(value: string, checked: boolean): string[] {
    if (value === 'public' || value === 'members') return checked ? [value] : ['public'];
    const roles = selected.filter((item) => ['judge', 'steward', 'veterinarian'].includes(item));
    const next = checked ? [...new Set([...roles, value])] : roles.filter((item) => item !== value);
    return next.length ? next : ['public'];
  }

  function updateAudience(value: string, checked: boolean) {
    if (saving) return;
    const previous = selected;
    const next = nextAudience(value, checked);
    setSelected(next);
    setSavingTarget(next);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('csrf_token', readCsrfTokenFromDocumentCookie());
      formData.set('table', 'news');
      formData.set('id', String(id));
      formData.set('field', 'access');
      next.forEach((item) => formData.append('audience', item));
      try {
        const result = await updateAdminTableInlineField({}, formData);
        if (result.error) {
          setSelected(previous);
          setSavingTarget(null);
          window.alert(result.error);
          return;
        }
        router.refresh();
      } catch {
        setSelected(previous);
        setSavingTarget(null);
        window.alert('Unable to save this access change. Please try again.');
      }
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-busy={saving || undefined} aria-label="Edit News/Blog access" className="h-auto min-h-0 w-full justify-start gap-2 p-0 hover:bg-transparent" disabled={saving} variant="ghost">
          <span className="flex w-full flex-col items-start gap-1.5 whitespace-normal">
            {selected.map((value) => <Badge className="border-gold/40 bg-gold/10" key={value} variant="outline">{ACCESS_LABELS[value] ?? value}</Badge>)}
          </span>
          {saving && <LoaderCircle aria-label="Updating access" className="size-4 shrink-0 animate-spin text-gold" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="space-y-2">
          {ACCESS_OPTIONS.map((option) => (
            <Label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-normal hover:bg-accent" key={option.value}>
              <Checkbox
                checked={selected.includes(option.value)}
                disabled={saving}
                onCheckedChange={(checked) => updateAudience(option.value, checked === true)}
              />
              {option.label}
            </Label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function downloadSelected(rows: ResourceRow[], columns: ResourceConfig['columns'], type: ResourceType) {
  downloadCsv(
    `${type}-selected.csv`,
    columns.map((column) => column.label),
    rows.map((row) => columns.map((column) => String(row[column.id] ?? ''))),
  );
}

function filterToken(columnFilters: ColumnFiltersState, id: string): string | undefined {
  const value = columnFilters.find((filter) => filter.id === id)?.value;
  const list = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return list.length ? list.join(',') : undefined;
}

export function ResourceDataTable({
  initialColumnOrder, initialFrom, initialSearch, initialSort, initialStatus, initialType, initialTo, initialVisibleColumns, page, pageSize, rows, tableType, total,
}: {
  initialColumnOrder?: string;
  initialFrom?: string;
  initialSearch?: string;
  initialSort?: string;
  initialStatus?: string;
  initialType?: string;
  initialTo?: string;
  initialVisibleColumns?: string[];
  page: number;
  pageSize: number;
  rows: ResourceRow[];
  tableType: ResourceType;
  total: number;
}) {
  const config = CONFIG[tableType];
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch ?? '');
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const openTableAction = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    startTransition(() => router.push(href));
  }, [router]);
  const optional = useMemo(() => config.columns.filter(({ id }) => id !== 'title').map(({ id }) => id), [config]);
  const initialVisibility = useMemo(() => {
    if (!initialVisibleColumns) return {};
    return Object.fromEntries(optional.map((id) => [id, initialVisibleColumns.includes(id)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount, matching useDataTable's own initialState-is-only-read-once contract.
  }, []);
  const columns = useMemo<ColumnDef<ResourceRow>[]>(() => {
    const header = (id: ResourceColumn, label: string) => ({ column }: HeaderContext<ResourceRow, unknown>) => (
      <DataTableColumnHeader
        className={tableType === 'news' && (id === 'publication' || id === 'updated') ? 'w-full min-w-0 justify-between whitespace-nowrap px-1' : undefined}
        column={column}
        label={label}
      />
    );
    return [
      {
        id: 'select', enableHiding: false, enableSorting: false, size: 40,
        header: ({ table }) => <Checkbox aria-label="Select all rows on this page" checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')} onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))} />,
        cell: ({ row }) => <Checkbox aria-label={`Select ${row.original.title}`} checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(Boolean(value))} />,
      },
      ...config.columns.map(({ id, label }): ColumnDef<ResourceRow> => ({
        id,
        accessorFn: (row) => row[id] ?? '',
        enableHiding: id !== 'title',
        enableSorting: ['title', 'type', 'status', 'publication', 'updated', 'date', 'start', 'end', 'deadline', 'registrations'].includes(id),
        enableColumnFilter: id === 'status' || (tableType === 'news' && id === 'type'),
        header: header(id, label),
        meta: id === 'status'
          ? { label, options: config.statuses, variant: 'multiSelect' }
          : id === 'type' && tableType === 'news'
            ? { label, options: config.types ?? [], variant: 'multiSelect' }
            : { label, variant: 'text' },
        cell: ({ row }) => id === 'title'
          ? tableType === 'news'
            ? <span className="block w-full whitespace-normal"><span className="block break-words font-medium">{row.original.title}</span><span className="mt-1 block break-all text-xs text-muted-foreground">{row.original.slug}</span></span>
            : <span className="font-medium">{row.original.title}</span>
          : id === 'status' && (tableType === 'seminars' || tableType === 'news')
            ? <InlineStatusEditor id={row.original.id} key={`${row.original.id}:${row.original.status}`} status={row.original.status} tableType={tableType} />
              : id === 'type' && tableType === 'news'
                ? (() => { const Icon = row.original.type === 'blog' ? BookOpenText : Newspaper; return <span className="inline-flex items-center gap-2 font-medium"><Icon aria-hidden className="size-4" />{String(row.original.type ?? 'news').toUpperCase()}</span>; })()
                : id === 'access' && tableType === 'news'
                  ? <InlineAccessEditor access={row.original.access} id={row.original.id} key={`${row.original.id}:${(row.original.access?.length ? row.original.access : ['public']).join('|')}`} />
                  : <span>{row.original[id] ?? '—'}</span>,
      })),
      {
        id: 'actions', enableHiding: false, enableSorting: false, meta: { label: 'Actions' }, size: 90,
        // Matches DataTableColumnHeader's own look (a native button, so the sitewide
        // uppercase/bold/letter-spacing rule already applies) instead of a bespoke size/weight,
        // only tinting it gold -- the same treatment as every other Actions column. Non-hideable:
        // this column has no accessorFn, so it never appears in the View popover to be restored.
        header: () => <DataTableStaticHeader className="text-gold" label="Actions" />,
        cell: ({ row }) => <div className="flex items-center gap-1">
          <Button asChild aria-label="Edit" size="icon-sm" title="Edit" variant="ghost">
            <Link
              href={tableType === 'news' ? `/admin/news?articleId=${row.original.id}` : tableType === 'seminars' ? `/admin/seminars?seminarId=${row.original.id}` : `${config.path}/${row.original.id}`}
              onClick={(event) => {
                const href = tableType === 'news' ? `/admin/news?articleId=${row.original.id}` : tableType === 'seminars' ? `/admin/seminars?seminarId=${row.original.id}` : `${config.path}/${row.original.id}`;
                openTableAction(event, href);
              }}
            ><Pencil aria-hidden="true" /></Link>
          </Button>
          {tableType === 'seminars' && <>
            <Button asChild aria-label="Registrations" size="icon-sm" title="View registrations" variant="ghost">
              <Link href={`/admin/seminars/registrations?seminarId=${row.original.id}`} onClick={(event) => openTableAction(event, `/admin/seminars/registrations?seminarId=${row.original.id}`)}><ClipboardList aria-hidden="true" /></Link>
            </Button>
            <Button asChild aria-label="Download registrations" size="icon-sm" title="Download this seminar's registrations" variant="ghost">
              <a download href={`/api/admin/export/seminar-registrations?seminarId=${row.original.id}`}><Download aria-hidden="true" /></a>
            </Button>
          </>}
        </div>,
      },
    ];
  }, [config, openTableAction, tableType]);
  const defaultColumnOrder = tableType === 'seminars'
    ? ['select', 'title', 'status', 'prices', 'start', 'end', 'deadline', 'registrations', 'actions']
    : tableType === 'news'
      ? ['select', 'title', 'type', 'status', 'access', 'publication', 'updated', 'actions']
      : ['select', ...config.columns.map(({ id }) => id), 'actions'];
  const defaultSortId = tableType === 'news' ? 'publication' : tableType === 'seminars' ? 'start' : 'updated';
  const initialSorting = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(initialSort || '[]');
      if (Array.isArray(parsed) && parsed.length && config.columns.some(({ id }) => id === parsed[0]?.id)) return parsed;
    } catch { /* fall through to the default below */ }
    return [{ desc: true, id: defaultSortId }];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount.
  }, []);
  // Facet filters are applied server-side from saved preferences regardless of this initial
  // state, so this must mirror what the server actually applied -- otherwise the toolbar shows no
  // active facets while the table is already filtered, and the next unrelated change persists
  // `undefined` for these, silently clearing the saved view.
  const initialColumnFilters = useMemo(() => [
    { id: 'status', value: initialStatus ? initialStatus.split(',') : [] },
    { id: 'type', value: initialType ? initialType.split(',') : [] },
  ].filter((filter) => filter.value.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at mount.
    []);

  // Persists to the database and refetches via a same-URL router.refresh() -- deliberately never
  // writes any of this to the URL. `overrides` lets Reset atomically change search/date-range
  // alongside table state without racing separate persist calls against each other.
  function persistAndRefresh(state: DataTableLiveState, overrides?: { from?: string; to?: string; q?: string }) {
    const effectiveSearch = overrides && 'q' in overrides ? overrides.q : search;
    const effectiveFrom = overrides && 'from' in overrides ? overrides.from : from;
    const effectiveTo = overrides && 'to' in overrides ? overrides.to : to;
    const preferences: TablePreferenceState = {
      columnOrder: table.getState().columnOrder.join(','),
      columns: optional.filter((id) => table.getState().columnVisibility[id] !== false),
      page: state.pagination.pageIndex + 1,
      pageSize: state.pagination.pageSize,
      q: effectiveSearch || undefined,
      sort: state.sorting.length ? JSON.stringify(state.sorting) : undefined,
      status: filterToken(state.columnFilters, 'status'),
      type: tableType === 'news' ? filterToken(state.columnFilters, 'type') : undefined,
    };
    if (config.dateFilter) { preferences.from = effectiveFrom; preferences.to = effectiveTo; }
    void persistTablePreferences(tableType, preferences).then((response) => {
      if (!response.ok) setError('Table preferences could not be saved.');
    }).catch(() => setError('Table preferences could not be saved.')).finally(() => startTransition(() => router.refresh()));
  }

  const { table } = useDataTable({
    columns, data: rows,
    // Simple (non-advanced) mode is required for the auto-rendered status/audience faceted
    // filters below to sync through `column.setFilterValue` -- advanced mode no-ops that path.
    enableAdvancedFilter: false,
    getRowId: (row) => String(row.id),
    initialState: { columnFilters: initialColumnFilters, columnOrder: initialColumnOrder?.split(',') ?? defaultColumnOrder, columnVisibility: initialVisibility, pagination: { pageIndex: page - 1, pageSize }, sorting: initialSorting },
    onLiveStateChange: (state) => persistAndRefresh(state),
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    startTransition,
  });

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
    setFrom(undefined);
    setTo(undefined);
    setDateResetSignal((signal) => signal + 1);
    // `true` forces a blank reset ([]) -- omitting it resets to `initialState.columnFilters`, which
    // is non-empty whenever a facet was already applied when this table mounted.
    table.resetColumnFilters(true);
    persistAndRefresh(
      { columnFilters: [], pagination: table.getState().pagination, sorting: table.getState().sorting },
      { from: undefined, to: undefined, q: undefined },
    );
  }

  // A manual filter change (search, date range) must return to page 1 -- otherwise staying on
  // page N of a now-narrower result set can show an empty table, or even "Page N of 1".
  const debouncedSearchPersist = useDebouncedCallback((value: string) => {
    persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: { ...table.getState().pagination, pageIndex: 0 }, sorting: table.getState().sorting }, { q: value });
  }, 300);

  const selected = table.getSelectedRowModel().rows.map((row) => row.original);
  const actionBarVisibility = useActionBarVisibility(selected.length);
  // `manuallyFiltered` drives the Reset button's visibility, so it deliberately excludes `q`
  // (search) -- the search box has its own clear affordance. `filtered` drives the empty-state
  // copy, so it must include `q`: a search that matches nothing is still "no records match this
  // view", not "no records exist at all".
  const [dateDraftActive, setDateDraftActive] = useState(false);
  const [dateResetSignal, setDateResetSignal] = useState(0);
  const manuallyFiltered = Boolean(from || to) || dateDraftActive;
  const filtered = manuallyFiltered || Boolean(search) || table.getState().columnFilters.length > 0;
  const newsColumnStyles = tableType === 'news'
    ? {
      select: { width: '42px' },
      type: { width: '90px' },
      status: { width: '122px' },
      access: { width: '130px' },
      publication: { width: '180px' },
      updated: { width: '190px' },
      actions: { width: '92px' },
    }
    : undefined;
  return <>
    <TablePreferenceSync table={tableType as AdminTableIdentifier} />
    <DataTable table={table} tableClassName={tableType === 'news' ? 'table-fixed' : undefined} columnStyles={newsColumnStyles} pageSizeOptions={[10, 25, 50, 100]} loading={isPending} emptyState={<div><strong>{filtered ? 'No records match this view' : 'No records yet'}</strong><span className="block text-muted-foreground">{filtered ? 'Change or clear the filters.' : 'Create a record to get started.'}</span></div>} actionBar={<ActionBar open={actionBarVisibility.open} onOpenChange={actionBarVisibility.onOpenChange}><ActionBarSelection>{selected.length} selected</ActionBarSelection><ActionBarGroup><ActionBarItem onSelect={() => downloadSelected(selected, config.columns, tableType)}>Export selected CSV</ActionBarItem>{tableType === 'news' ? <BulkNewsStatusSelected clearSelection={() => table.resetRowSelection()} ids={selected.map((row) => String(row.id))} /> : null}<BulkDeleteSelected clearSelection={() => table.resetRowSelection()} ids={selected.map((row) => String(row.id))} table={tableType} /><ActionBarItem onSelect={() => table.resetRowSelection()}>Clear selection</ActionBarItem></ActionBarGroup><ActionBarClose aria-label="Close selected-row actions"><X /></ActionBarClose></ActionBar>}>
      <DataTableToolbar
        className="mt-5 rounded-xl border bg-background p-3"
        table={table}
        isFiltered={manuallyFiltered}
        pending={isPending}
        onReset={resetAll}
        leading={<>
          <Input
            aria-label={config.searchLabel}
            className="h-8 w-40 lg:w-56"
            onChange={(event) => { setSearch(event.target.value); table.setPageIndex(0); debouncedSearchPersist(event.target.value); }}
            placeholder="Search…"
            type="search"
            value={search}
          />
          {config.dateFilter && (
            <DateRangeFilter
              from={from}
              label="Date"
              onChange={(newFrom, newTo) => { setFrom(newFrom); setTo(newTo); table.setPageIndex(0); persistAndRefresh({ columnFilters: table.getState().columnFilters, pagination: { ...table.getState().pagination, pageIndex: 0 }, sorting: table.getState().sorting }, { from: newFrom, to: newTo }); }}
              onDraftActiveChange={setDateDraftActive}
              resetSignal={dateResetSignal}
              to={to}
            />
          )}
        </>}
      />
      <DataTableActionsRow count={`${total} matching records`} table={table}>
        <DataTableSortList table={table} />
      </DataTableActionsRow>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </DataTable>
  </>;
}
