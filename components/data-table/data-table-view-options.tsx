"use client";

import type { Column, Table } from "@tanstack/react-table";
import { GripVertical, Settings2 } from "lucide-react";
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
  const currentOrder = table.getState().columnOrder;
  const columns = table.getAllColumns()
    .filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide())
    .sort((a, b) => {
      const aPosition = currentOrder.indexOf(a.id);
      const bPosition = currentOrder.indexOf(b.id);
      return aPosition >= 0 && bPosition >= 0 ? aPosition - bPosition
        : (a.columnDef.meta?.label ?? a.id).localeCompare(b.columnDef.meta?.label ?? b.id, 'en');
    })
    // Visible columns always list above hidden ones (stable sort preserves each group's relative
    // order from above), so the checked columns a user is actively working with aren't scattered
    // among a long tail of hidden ones.
    .sort((a, b) => Number(b.getIsVisible()) - Number(a.getIsVisible()));

  function toggleColumn(column: (typeof columns)[number]) {
    const nextVisible = !column.getIsVisible();
    column.toggleVisibility(nextVisible);
    // Only touch sorting when the hidden column was actually part of the current sort, rather than
    // firing a state update (and the persistence/refetch it triggers) on every hide regardless.
    if (!nextVisible && table.getState().sorting.some((item) => item.id === column.id)) {
      table.setSorting((sorting) => sorting.filter((item) => item.id !== column.id));
    }
  }

  function onOrderChange(nextColumns: (typeof columns)) {
    const movable = nextColumns.map((column) => column.id);
    const fixed = currentOrder.filter((id) => !movable.includes(id) && id !== 'actions');
    const trailing = currentOrder.includes('actions') && !movable.includes('actions') ? ['actions'] : [];
    const nextOrder = [...fixed, ...movable, ...trailing];
    table.setColumnOrder(nextOrder);
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
