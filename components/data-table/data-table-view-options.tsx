"use client";

import type { Column, Table } from "@tanstack/react-table";
import { GripVertical, Settings2 } from "lucide-react";
import { parseAsArrayOf, parseAsString, useQueryState } from "nuqs";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
  SortableOverlay,
} from "@/components/ui/sortable";
import { cn } from "@/lib/utils";
import { getDefaultColumnOrder } from "@/lib/data-table";

interface DataTableViewOptionsProps<TData>
  extends React.ComponentProps<typeof PopoverContent> {
  table: Table<TData>;
  disabled?: boolean;
}

export function DataTableViewOptions<TData>({
  table,
  disabled,
  className,
  ...props
}: DataTableViewOptionsProps<TData>) {
  const [savedOrder, setSavedOrder] = useQueryState('columnOrder', parseAsArrayOf(parseAsString, ',').withOptions({ shallow: true }));
  const previousSavedOrder = React.useRef(savedOrder);
  const currentOrder = table.getState().columnOrder;
  const columns = table.getAllColumns()
    .filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide())
    .sort((a, b) => {
      const aPosition = currentOrder.indexOf(a.id);
      const bPosition = currentOrder.indexOf(b.id);
      return aPosition >= 0 && bPosition >= 0 ? aPosition - bPosition
        : (a.columnDef.meta?.label ?? a.id).localeCompare(b.columnDef.meta?.label ?? b.id, 'en');
    });

  React.useEffect(() => {
    if (!savedOrder?.length) {
      if (previousSavedOrder.current?.length) table.setColumnOrder(getDefaultColumnOrder(table.getAllColumns().map((column) => column.columnDef)));
      previousSavedOrder.current = savedOrder;
      return;
    }
    const ids = new Set(table.getAllColumns().map((column) => column.id));
    const ordered = [...new Set(savedOrder.filter((id) => ids.has(id)))];
    const next = [...ordered, ...table.getState().columnOrder.filter((id) => !ordered.includes(id))];
    if (next.join(',') !== table.getState().columnOrder.join(',')) table.setColumnOrder(next);
    previousSavedOrder.current = savedOrder;
  }, [savedOrder, table]);

  function toggleColumn(column: (typeof columns)[number]) {
    const nextVisible = !column.getIsVisible();
    column.toggleVisibility(nextVisible);
    if (!nextVisible) table.setSorting((sorting) => sorting.filter((item) => item.id !== column.id));
  }

  function onOrderChange(nextColumns: (typeof columns)) {
    const movable = nextColumns.map((column) => column.id);
    const fixed = currentOrder.filter((id) => !movable.includes(id) && id !== 'actions');
    const trailing = currentOrder.includes('actions') && !movable.includes('actions') ? ['actions'] : [];
    const nextOrder = [...fixed, ...movable, ...trailing];
    table.setColumnOrder(nextOrder);
    void setSavedOrder(nextOrder);
  }

  const labelFor = (column: Column<TData, unknown>) => column.columnDef.meta?.label ?? column.id;

  return (
    <Sortable
      value={columns}
      onValueChange={onOrderChange}
      getItemValue={(column) => column.id}
      orientation="vertical"
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            data-idoc-table-control
            aria-label="Toggle columns"
            role="combobox"
            variant="outline"
            className="ml-auto h-8 font-normal"
            disabled={disabled}
          >
            <Settings2 className="text-muted-foreground" />
            View
          </Button>
        </PopoverTrigger>
        <PopoverContent
          data-idoc-table-panel
          align="end"
          sideOffset={8}
          className={cn("w-64 p-2", className)}
          {...props}
        >
          <p className="px-1 pb-2 text-muted-foreground text-xs">
            Toggle visibility, drag <GripVertical aria-hidden="true" className="inline size-3 align-text-bottom" /> to reorder
          </p>
          <SortableContent asChild>
            <div role="list" className="flex max-h-[300px] flex-col gap-0.5 overflow-y-auto">
              {columns.map((column) => {
                const inputId = `data-table-view-${column.id}`;
                return (
                  <SortableItem key={column.id} value={column.id} asChild>
                    <div
                      role="listitem"
                      className="flex items-center gap-2 rounded-sm px-1.5 py-1.5 text-sm hover:bg-accent"
                    >
                      <SortableItemHandle
                        aria-label={`Move ${labelFor(column)}`}
                        className="flex shrink-0 items-center justify-center rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <GripVertical aria-hidden="true" className="size-4" />
                      </SortableItemHandle>
                      <Checkbox
                        id={inputId}
                        checked={column.getIsVisible()}
                        onCheckedChange={() => toggleColumn(column)}
                      />
                      <label htmlFor={inputId} className="flex-1 cursor-pointer truncate">
                        {labelFor(column)}
                      </label>
                    </div>
                  </SortableItem>
                );
              })}
            </div>
          </SortableContent>
        </PopoverContent>
      </Popover>
      <SortableOverlay>
        {({ value }) => (
          <div className="flex items-center gap-2 rounded-sm border bg-popover px-1.5 py-1.5 text-sm shadow-md">
            <GripVertical aria-hidden="true" className="size-4 text-muted-foreground" />
            {labelFor(columns.find((column) => column.id === value) ?? columns[0])}
          </div>
        )}
      </SortableOverlay>
    </Sortable>
  );
}
