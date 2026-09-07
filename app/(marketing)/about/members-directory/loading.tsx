export default function MembersDirectoryLoading() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading the members map…</p>
      <div className="animate-pulse space-y-3" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="h-7 w-full max-w-xl rounded bg-surface" key={index} />
        ))}
      </div>
    </section>
  );
}
