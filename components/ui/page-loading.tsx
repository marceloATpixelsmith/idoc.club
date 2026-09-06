import { Loader2 } from 'lucide-react';

/** Next.js instant-loading fallback for a route segment's async server work (DB reads in a
 * layout/page). Shown automatically by the framework the moment navigation starts, replacing the
 * segment's content until it resolves -- see the sibling loading.tsx files that render this. */
export function PageLoading() {
  return (
    <div className="relative flex min-h-[50vh] flex-1 items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-surface/40 backdrop-blur-md" />
      <div className="relative flex flex-col items-center gap-4">
        <Loader2 className="size-8 animate-spin text-gold" aria-hidden="true" />
        <p className="eyebrow">Loading</p>
      </div>
    </div>
  );
}
