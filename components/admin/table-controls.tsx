import Link from 'next/link';

export function ActiveFilterChips({ filters, pathname }: { filters: { label: string; name: string; value?: string }[]; pathname: string }) {
  const active = filters.filter((filter) => filter.value);
  if (active.length === 0) return null;
  return <div aria-label="Active filters" className="flex flex-wrap items-center gap-2">
    <span className="text-sm font-medium">Active filters:</span>
    {active.map((filter) => <span className="rounded-full border bg-muted px-3 py-1 text-xs" key={filter.name}>{filter.label}: {filter.value}</span>)}
    <Link className="text-sm font-medium underline" href={pathname}>Clear all</Link>
  </div>;
}

export function ColumnVisibility({ columns, hidden }: { columns: { label: string; value: string }[]; hidden: Set<string> }) {
  return <details className="relative self-end rounded border px-3 py-2">
    <summary className="cursor-pointer text-sm font-medium">Columns</summary>
    <fieldset className="absolute right-0 z-10 mt-3 min-w-48 space-y-2 rounded border bg-background p-3 shadow-lg">
      <legend className="sr-only">Visible columns</legend>
      {columns.map((column) => <label className="flex gap-2 text-sm" key={column.value}>
        <input defaultChecked={!hidden.has(column.value)} name="column" type="checkbox" value={column.value} />{column.label}
      </label>)}
    </fieldset>
  </details>;
}

export function parseHiddenColumns(value: string | string[] | undefined, allColumns: readonly string[]) {
  const visible = new Set(Array.isArray(value) ? value : value ? [value] : allColumns);
  return new Set(allColumns.filter((column) => !visible.has(column)));
}
