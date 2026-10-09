export default function RevenueLoading() {
  return <main aria-busy="true" aria-live="polite" className="animate-pulse flex-1 space-y-6 p-8"><div className="h-8 w-56 rounded bg-muted" /><div className="grid gap-4 sm:grid-cols-4">{[1, 2, 3, 4].map((item) => <div className="h-28 rounded-lg bg-muted" key={item} />)}</div></main>;
}
