import type { Column, ColumnDef } from "@tanstack/react-table";
import type React from "react";

import { dataTableConfig } from "@/config/data-table";
import type {
  ExtendedColumnFilter,
  FilterOperator,
  FilterVariant,
} from "@/types/data-table";

export function getDefaultColumnOrder<TData>(columns: ColumnDef<TData>[]): string[] {
  const id = (column: ColumnDef<TData>) => column.id ?? ('accessorKey' in column ? String(column.accessorKey) : '');
  const fixed = columns.filter((column) => column.enableHiding === false && column.id !== 'actions').map(id);
  const movable = columns.filter((column) => column.enableHiding !== false && column.id !== 'actions')
    .sort((a, b) => (a.meta?.label ?? id(a)).localeCompare(b.meta?.label ?? id(b), 'en')).map(id);
  return [...fixed, ...movable, ...(columns.some((column) => column.id === 'actions') ? ['actions'] : [])].filter(Boolean);
}

export function getColumnPinningStyle<TData>({
  column,
  withBorder = false,
}: {
  column: Column<TData>;
  withBorder?: boolean;
}): React.CSSProperties {
  const isPinned = column.getIsPinned();
  const isLastLeftPinnedColumn =
    isPinned === "left" && column.getIsLastColumn("left");
  const isFirstRightPinnedColumn =
    isPinned === "right" && column.getIsFirstColumn("right");

  return {
    boxShadow: withBorder
      ? isLastLeftPinnedColumn
        ? "-4px 0 4px -4px var(--border) inset"
        : isFirstRightPinnedColumn
          ? "4px 0 4px -4px var(--border) inset"
          : undefined
      : undefined,
    left: isPinned === "left" ? `${column.getStart("left")}px` : undefined,
    right: isPinned === "right" ? `${column.getAfter("right")}px` : undefined,
    opacity: isPinned ? 0.97 : 1,
    position: isPinned ? "sticky" : "relative",
    // A pinned column needs an opaque background so scrolled-under content doesn't show through
    // it; an unpinned cell must NOT get one, since an inline style always wins over the row/header
    // CSS classes that are supposed to color it (the header's --surface-raised band, a hovered or
    // selected body row's highlight) -- this previously set `var(--background)` unconditionally,
    // silently overriding those on every cell in every table regardless of pinning.
    background: isPinned ? "var(--background)" : undefined,
    width: column.getSize(),
    zIndex: isPinned ? 1 : undefined,
  };
}

export function getFilterOperators(filterVariant: FilterVariant) {
  const operatorMap: Record<
    FilterVariant,
    { label: string; value: FilterOperator }[]
  > = {
    text: dataTableConfig.textOperators,
    number: dataTableConfig.numericOperators,
    range: dataTableConfig.numericOperators,
    date: dataTableConfig.dateOperators,
    dateRange: dataTableConfig.dateOperators,
    boolean: dataTableConfig.booleanOperators,
    select: dataTableConfig.selectOperators,
    multiSelect: dataTableConfig.multiSelectOperators,
  };

  return operatorMap[filterVariant] ?? dataTableConfig.textOperators;
}

export function getDefaultFilterOperator(filterVariant: FilterVariant) {
  const operators = getFilterOperators(filterVariant);

  return operators[0]?.value ?? (filterVariant === "text" ? "iLike" : "eq");
}

export function getValidFilters<TData>(
  filters: ExtendedColumnFilter<TData>[],
): ExtendedColumnFilter<TData>[] {
  return filters.filter(
    (filter) =>
      filter.operator === "isEmpty" ||
      filter.operator === "isNotEmpty" ||
      (Array.isArray(filter.value)
        ? filter.value.length > 0
        : filter.value !== "" &&
          filter.value !== null &&
          filter.value !== undefined),
  );
}
