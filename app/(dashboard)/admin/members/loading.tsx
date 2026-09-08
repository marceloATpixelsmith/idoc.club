export default function MembersLoading() {
  return <main aria-busy="true" aria-live="polite" className="flex-1 p-8"><h1 className="text-2xl font-semibold">Members</h1><p className="mt-4 text-sm text-muted-foreground">Loading membership roster…</p><div className="mt-6 h-64 animate-pulse rounded-xl bg-surface" /></main>;
}
