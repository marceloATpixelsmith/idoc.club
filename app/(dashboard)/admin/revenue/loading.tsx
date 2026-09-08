export default function RevenueLoading() {
  return <main aria-busy="true" aria-live="polite" className="flex-1 p-8"><h1 className="text-2xl font-semibold">Membership revenue</h1><p className="mt-4 text-sm text-muted-foreground">Loading recorded revenue…</p><div className="mt-6 grid gap-4 sm:grid-cols-4">{[1, 2, 3, 4].map((item) => <div className="h-28 animate-pulse rounded-lg bg-surface" key={item} />)}</div></main>;
}
