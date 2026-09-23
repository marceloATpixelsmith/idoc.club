"use client";

import type { Table } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";
import { parseAsArrayOf, parseAsString, useQueryState } from "nuqs";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const [savedOrder, setSavedOrder] = useQueryState('columnOrder', parseAsArrayOf(parseAsString, ',').withOptions({ shallow: true }));
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
    if (!savedOrder?.length) return;
    const ids = new Set(table.getAllColumns().map((column) => column.id));
    const ordered = [...new Set(savedOrder.filter((id) => ids.has(id)))];
    const next = [...ordered, ...table.getState().columnOrder.filter((id) => !ordered.includes(id))];
    if (next.join(',') !== table.getState().columnOrder.join(',')) table.setColumnOrder(next);
  }, [savedOrder, table]);

  function toggleColumn(column: (typeof columns)[number]) {
    const nextVisible = !column.getIsVisible();
    column.toggleVisibility(nextVisible);
    if (!nextVisible) table.setSorting((sorting) => sorting.filter((item) => item.id !== column.id));
  }

  function moveColumn(index: number, offset: number) {
    const movable = columns.map((column) => column.id);
    const target = index + offset;
    if (target < 0 || target >= movable.length) return;
    [movable[index], movable[target]] = [movable[target], movable[index]];
    const fixed = currentOrder.filter((id) => !movable.includes(id) && id !== 'actions');
    const trailing = currentOrder.includes('actions') && !movable.includes('actions') ? ['actions'] : [];
    const nextOrder = [...fixed, ...movable, ...trailing];
    table.setColumnOrder(nextOrder);
    void setSavedOrder(nextOrder);
  }

  return (
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
      <PopoverContent data-idoc-table-panel align="end" sideOffset={8} className={cn("w-72 p-1", className)} {...props}>
        <Command>
          <CommandInput placeholder="Search columns..." />
          <CommandList>
            <CommandEmpty>No columns found.</CommandEmpty>
            <CommandGroup>
              {columns.map((column, index) => (
                <CommandItem
                  key={column.id}
                  data-checked={column.getIsVisible()}
                  onSelect={() => toggleColumn(column)}
                >
                  <input
                    aria-label={`Show ${column.columnDef.meta?.label ?? column.id}`}
                    checked={column.getIsVisible()}
                    className="size-4 shrink-0 accent-[var(--gold)]"
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggleColumn(column)}
                    tabIndex={-1}
                    type="checkbox"
                  />
                  <span className="truncate">
                    {column.columnDef.meta?.label ?? column.id}
                  </span>
                  <span className="ml-auto flex shrink-0 gap-1">
                    <button aria-label={`Move ${column.columnDef.meta?.label ?? column.id} up`} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveColumn(index, -1); }} onKeyDown={(event) => event.stopPropagation()} title="Move left" type="button"><ArrowUp aria-hidden="true" className="size-4" /></button>
                    <button aria-label={`Move ${column.columnDef.meta?.label ?? column.id} down`} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={index === columns.length - 1} onClick={(event) => { event.stopPropagation(); moveColumn(index, 1); }} onKeyDown={(event) => event.stopPropagation()} title="Move right" type="button"><ArrowDown aria-hidden="true" className="size-4" /></button>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
