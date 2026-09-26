"use client";

import type { Column, Table } from "@tanstack/react-table";
import { LoaderCircle, X } from "lucide-react";
import * as React from "react";

import { DataTableDateFilter } from "@/components/data-table/data-table-date-filter";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { DataTableSliderFilter } from "@/components/data-table/data-table-slider-filter";
import { DataTableViewOptions } from "@/components/data-table/data-table-view-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface DataTableToolbarProps<TData> extends React.ComponentProps<"div"> {
  table: Table<TData>;
  /** Extra controls rendered before the auto-generated per-column filters, e.g. a search input. */
  leading?: React.ReactNode;
  /** Called in addition to clearing column filters, to also clear manually-managed filters. */
  onReset?: () => void;
  /** OR'd with the column-filter-driven detection to decide whether the Reset button shows. */
  isFiltered?: boolean;
  /** Extra controls rendered after View, at the very end of the toolbar (e.g. a download/export icon). */
  trailing?: React.ReactNode;
  /** Whether the surrounding table is currently applying a search/filter/sort/pagination change --
   * the same value passed to the table's own `loading` prop. Reset's spinner and visibility follow
   * this rather than an internal transition around `resetColumnFilters()`: that call only updates
   * local tanstack state synchronously (the real URL/server round trip is a separate, debounced
   * update), so a transition scoped to it alone resolves, and `isFiltered` flips false, well before
   * the actual navigation finishes -- omit this prop where filtering has no async round trip. */
  pending?: boolean;
}

export function DataTableToolbar<TData>({
  table,
  leading,
  onReset: onResetProp,
  isFiltered: isFilteredProp,
  trailing,
  pending,
  children,
  className,
  ...props
}: DataTableToolbarProps<TData>) {
  const isFiltered =
    table.getState().columnFilters.length > 0 || Boolean(isFilteredProp);

  const columns = React.useMemo(
    () => table.getAllColumns().filter((column) => column.getCanFilter()),
    [table],
  );

  // Only latched when a caller actually reports async pending state -- a caller that never passes
  // `pending` (filtering is synchronous, e.g. AdminReadOnlyTable) never sets this, so the button
  // reverts to following `isFiltered` alone rather than getting stuck open forever: `pending` would
  // stay `undefined` after a reset, so the effect below (keyed on `pending`) would never re-run to
  // clear a latch that was set.
  const [pendingReset, setPendingReset] = React.useState(false);
  const onReset = React.useCallback(() => {
    if (pending !== undefined) setPendingReset(true);
    table.resetColumnFilters();
    onResetProp?.();
  }, [pending, table, onResetProp]);
  React.useEffect(() => {
    if (!pending) setPendingReset(false);
  }, [pending]);
  const showReset = isFiltered || (pending !== undefined && pendingReset);
  const isResetting = pendingReset && Boolean(pending);

  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      className={cn(
        "flex w-full items-start justify-between gap-2 p-1",
        className,
      )}
      {...props}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {leading}
        {columns.map((column) => (
          <DataTableToolbarFilter key={column.id} column={column} />
        ))}
        {showReset && (
          <Button
            data-idoc-table-control
            aria-label="Reset filters"
            aria-busy={isResetting}
            variant="outline"
            className="border-dashed"
            disabled={isResetting}
            onClick={onReset}
          >
            {isResetting ? <LoaderCircle className="animate-spin" /> : <X />}
            Reset
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {children}
        <DataTableViewOptions table={table} align="end" />
        {trailing}
      </div>
    </div>
  );
}
interface DataTableToolbarFilterProps<TData> {
  column: Column<TData>;
}

function DataTableToolbarFilter<TData>({
  column,
}: DataTableToolbarFilterProps<TData>) {
  {
    const columnMeta = column.columnDef.meta;

    const onFilterRender = React.useCallback(() => {
      if (!columnMeta?.variant) return null;

      switch (columnMeta.variant) {
        case "text":
          return (
            <Input
              placeholder={columnMeta.placeholder ?? columnMeta.label}
              value={(column.getFilterValue() as string) ?? ""}
              onChange={(event) => column.setFilterValue(event.target.value)}
              className="h-8 w-40 lg:w-56"
            />
          );

        case "number":
          return (
            <div className="relative">
              <Input
                type="number"
                inputMode="numeric"
                placeholder={columnMeta.placeholder ?? columnMeta.label}
                value={(column.getFilterValue() as string) ?? ""}
                onChange={(event) => column.setFilterValue(event.target.value)}
                className={cn("h-8 w-[120px]", columnMeta.unit && "pr-8")}
              />
              {columnMeta.unit && (
                <span className="absolute top-0 right-0 bottom-0 flex items-center rounded-r-md bg-accent px-2 text-muted-foreground text-sm">
                  {columnMeta.unit}
                </span>
              )}
            </div>
          );

        case "range":
          return (
            <DataTableSliderFilter
              column={column}
              title={columnMeta.label ?? column.id}
            />
          );

        case "date":
        case "dateRange":
          return (
            <DataTableDateFilter
              column={column}
              title={columnMeta.label ?? column.id}
              multiple={columnMeta.variant === "dateRange"}
            />
          );

        case "select":
        case "multiSelect":
          return (
            <DataTableFacetedFilter
              column={column}
              title={columnMeta.label ?? column.id}
              options={columnMeta.options ?? []}
              multiple={columnMeta.variant === "multiSelect"}
            />
          );

        default:
          return null;
      }
    }, [column, columnMeta]);

    return onFilterRender();
  }
}
