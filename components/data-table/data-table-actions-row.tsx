'use client';

import type { Table } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { DataTableViewOptions } from '@/components/data-table/data-table-view-options';
import { cn } from '@/lib/utils';

/**
 * The row-count text and the Sort/View/Download controls, placed above the table and outside the
 * filter box (search + per-column filters + Reset), not grouped inside it -- these act on the whole
 * table's presentation, not on narrowing which rows show. `mt-4` here (not left to each caller) is
 * the deliberate breathing room between the filter box above and this row.
 */
export function DataTableActionsRow<TData>({ children, className, count, table, trailing }: {
  children?: ReactNode;
  className?: string;
  count: ReactNode;
  table: Table<TData>;
  trailing?: ReactNode;
}) {
  return (
    <div className={cn('mt-4 flex items-center justify-between gap-2 px-1', className)}>
      <p aria-live="polite" className="text-sm text-muted-foreground">{count}</p>
      <div className="flex items-center gap-2">
        {children}
        <DataTableViewOptions align="end" table={table} />
        {trailing}
      </div>
    </div>
  );
}
