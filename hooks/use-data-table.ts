import {
  type ColumnFiltersState,
  type ColumnOrderState,
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type TableOptions,
  type TableState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import * as React from "react";

import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { getDefaultColumnOrder } from "@/lib/data-table";
import type { ExtendedColumnSort } from "@/types/data-table";

const DEBOUNCE_MS = 300;

export interface DataTableLiveState {
  pagination: PaginationState;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
}

interface UseDataTableProps<TData>
  extends Omit<
      TableOptions<TData>,
      | "state"
      | "pageCount"
      | "getCoreRowModel"
      | "manualFiltering"
      | "manualPagination"
      | "manualSorting"
    >,
    Required<Pick<TableOptions<TData>, "pageCount">> {
  initialState?: Omit<Partial<TableState>, "sorting"> & {
    sorting?: ExtendedColumnSort<TData>[];
  };
  debounceMs?: number;
  enableAdvancedFilter?: boolean;
  startTransition?: React.TransitionStartFunction;
  /**
   * Called (debounced) whenever pagination, sorting, or column filters change, so the caller can
   * persist the new state to the database and refetch -- deliberately never written to the URL.
   * Search-bar text and date-range filters aren't react-table state, so callers still own tracking
   * and persisting those themselves alongside this callback's output. Named onLiveStateChange, not
   * onStateChange, because TableOptions already declares its own onStateChange with a conflicting
   * signature (a react-table state updater function, not this hook's plain state object).
   */
  onLiveStateChange?: (state: DataTableLiveState) => void;
}

export function useDataTable<TData>(props: UseDataTableProps<TData>) {
  const {
    columns,
    pageCount = -1,
    initialState,
    debounceMs = DEBOUNCE_MS,
    enableAdvancedFilter = false,
    startTransition,
    onLiveStateChange,
    ...tableProps
  } = props;

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>(
    initialState?.rowSelection ?? {},
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialState?.columnVisibility ?? {});
  const defaultColumnOrder = React.useMemo(() => getDefaultColumnOrder(columns), [columns]);
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>(initialState?.columnOrder ?? defaultColumnOrder);
  const [pagination, setPagination] = React.useState<PaginationState>(
    initialState?.pagination ?? { pageIndex: 0, pageSize: 10 },
  );
  const [sorting, setSorting] = React.useState<SortingState>(initialState?.sorting ?? []);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    enableAdvancedFilter ? [] : (initialState?.columnFilters ?? []),
  );

  const debouncedNotify = useDebouncedCallback((state: DataTableLiveState) => {
    onLiveStateChange?.(state);
  }, debounceMs);

  const notify = React.useCallback((next: Partial<DataTableLiveState>, immediate = false) => {
    const state: DataTableLiveState = {
      pagination: next.pagination ?? pagination,
      sorting: next.sorting ?? sorting,
      columnFilters: next.columnFilters ?? columnFilters,
    };
    if (immediate) {
      // An immediate dispatch (page size, sort, column filter) supersedes any older debounced
      // snapshot still pending -- without this, that stale timer fires later and overwrites the
      // state this immediate call just persisted.
      debouncedNotify.cancel();
      onLiveStateChange?.(state);
    } else debouncedNotify(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- always read the latest closed-over values at call time, not at definition time.
  }, [pagination, sorting, columnFilters, onLiveStateChange, debouncedNotify]);

  const onPaginationChange = React.useCallback(
    (updaterOrValue: React.SetStateAction<PaginationState>) => {
      setPagination((prev) => {
        const next = typeof updaterOrValue === "function" ? updaterOrValue(prev) : updaterOrValue;
        // A page-size change is a deliberate, singular action -- apply it immediately rather than
        // waiting out the same debounce used for rapid-fire filter typing.
        notify({ pagination: next }, next.pageSize !== prev.pageSize);
        return next;
      });
    },
    [notify],
  );

  const onSortingChange = React.useCallback(
    (updaterOrValue: React.SetStateAction<SortingState>) => {
      setSorting((prev) => {
        const next = typeof updaterOrValue === "function" ? updaterOrValue(prev) : updaterOrValue;
        notify({ sorting: next, pagination: { ...pagination, pageIndex: 0 } }, true);
        return next;
      });
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
      // eslint-disable-next-line react-hooks/exhaustive-deps -- pagination read for the reset-to-page-1 side effect, not a reactive dependency of sorting itself.
    },
    [notify, pagination],
  );

  const onColumnFiltersChange = React.useCallback(
    (updaterOrValue: React.SetStateAction<ColumnFiltersState>) => {
      if (enableAdvancedFilter) return;
      setColumnFilters((prev) => {
        const next = typeof updaterOrValue === "function" ? updaterOrValue(prev) : updaterOrValue;
        notify({ columnFilters: next, pagination: { ...pagination, pageIndex: 0 } });
        return next;
      });
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
      // eslint-disable-next-line react-hooks/exhaustive-deps -- pagination read for the reset-to-page-1 side effect, not a reactive dependency of column filters itself.
    },
    [enableAdvancedFilter, notify, pagination],
  );

  const table = useReactTable({
    ...tableProps,
    columns,
    initialState,
    pageCount,
    state: {
      pagination,
      sorting,
      columnVisibility,
      columnOrder,
      rowSelection,
      columnFilters,
    },
    defaultColumn: {
      ...tableProps.defaultColumn,
      enableColumnFilter: false,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  return React.useMemo(() => ({ table, debounceMs }), [table, debounceMs]);
}
