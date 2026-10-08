'use client';

import { flexRender, type Table as TanstackTable } from "@tanstack/react-table";
import * as React from "react";
import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getColumnPinningStyle } from "@/lib/data-table";
import { cn } from "@/lib/utils";

type DataTableMutation = { begin: () => void; finish: (refresh?: boolean) => void };
const DataTableMutationContext = createContext<DataTableMutation | null>(null);

export function useDataTableMutation() {
  const value = useContext(DataTableMutationContext);
  if (!value) throw new Error("Bulk table actions must be used inside DataTable.");
  return value;
}

interface DataTableProps<TData> extends React.ComponentProps<"div"> {
  table: TanstackTable<TData>;
  actionBar?: React.ReactNode;
  columnStyles?: Record<string, React.CSSProperties>;
  tableClassName?: string;
  emptyState?: React.ReactNode;
  pageSizeOptions?: number[];
  /** True while a search/filter/sort/column-visibility/pagination change is being applied. */
  loading?: boolean;
}

export function DataTable<TData>({
  table,
  actionBar,
  columnStyles,
  tableClassName,
  emptyState,
  pageSizeOptions,
  loading,
  children,
  className,
  ...props
}: DataTableProps<TData>) {
  const router = useRouter();
  const [mutationPending, setMutationPending] = useState(false);
  const [drawerRefreshPending, setDrawerRefreshPending] = useState(false);
  React.useEffect(() => {
    const begin = () => setDrawerRefreshPending(true);
    window.addEventListener('idoc:table-refresh-start', begin);
    return () => window.removeEventListener('idoc:table-refresh-start', begin);
  }, []);
  React.useEffect(() => {
    //THE SERVER SUPPLIED NEW TABLE DATA; CLEAR THE DRAWER-INITIATED SKELETON.
    setDrawerRefreshPending(false);
  }, [table.options.data]);
  const [refreshPending, startRefresh] = useTransition();
  const isLoading = Boolean(loading || mutationPending || refreshPending || drawerRefreshPending);
  const mutation = React.useMemo<DataTableMutation>(() => ({
    begin: () => setMutationPending(true),
    finish: (refresh = true) => {
      setMutationPending(false);
      if (refresh) startRefresh(() => router.refresh());
    },
  }), [router]);
  return (
    <DataTableMutationContext.Provider value={mutation}>
    <div
      data-idoc-table-root
      className={cn("flex w-full flex-col gap-2.5 overflow-auto", className)}
      {...props}
    >
      {children}
      <div
        aria-busy={isLoading || undefined}
        className="relative overflow-hidden rounded-md border"
      >
        <Table className={tableClassName}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    data-pinned={header.column.getIsPinned() || undefined}
                    style={{
                      ...getColumnPinningStyle({ column: header.column, withBorder: true }),
                      ...columnStyles?.[header.column.id],
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              // A real skeleton (pulsing placeholder blocks) rather than dimming the outgoing
              // rows' opacity, which just reads as "the text got fainter," not as a loading state.
              // Matches the current row count so the table doesn't visibly resize between the last
              // real render and this one.
              Array.from({ length: Math.max(1, table.getRowModel().rows?.length || table.getState().pagination.pageSize) }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {table.getVisibleLeafColumns().map((column) => (
                    <TableCell key={column.id} data-pinned={column.getIsPinned() || undefined} style={{ ...getColumnPinningStyle({ column, withBorder: true }), ...columnStyles?.[column.id] }}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      data-pinned={cell.column.getIsPinned() || undefined}
                      style={{
                        ...getColumnPinningStyle({ column: cell.column, withBorder: true }),
                        ...columnStyles?.[cell.column.id],
                      }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getAllColumns().length}
                  className="h-24 text-center"
                >
                  {emptyState ?? "No results."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-2.5">
        <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
        {actionBar &&
          table.getFilteredSelectedRowModel().rows.length > 0 &&
          actionBar}
      </div>
    </div>
    </DataTableMutationContext.Provider>
  );
}
