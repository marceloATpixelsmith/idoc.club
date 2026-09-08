export default function MemberDirectoryLoading() {
  return (
    <main className="flex-1 py-4 lg:py-8 px-5 lg:px-8" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading the members directory…</p>
      <div className="animate-pulse space-y-3" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="h-8 w-full rounded bg-surface" key={index} />
        ))}
      </div>
    </main>
  );
}
