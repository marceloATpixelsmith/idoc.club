'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/report-client-error';

// Catches errors within any route segment that doesn't define a more specific error.tsx of its
// own; renders inside the existing root layout (unlike global-error.tsx, which replaces it).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-lg items-center px-5 py-16 text-center">
      <div className="w-full rounded-3xl border border-border bg-card px-6 py-12 shadow-sm sm:px-12">
      <div className="mx-auto mb-7 flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <span className="text-2xl font-semibold">!</span>
      </div>
      <h1 className="text-2xl font-medium text-foreground mb-2">Something went wrong</h1>
      <p className="text-muted-foreground mb-6">
        We hit an unexpected problem. Please try again, or return to the home page.
        {error.digest ? <span className="block text-xs text-muted-foreground mt-2">Reference: {error.digest}</span> : null}
      </p>
      <button
        className="rounded-full bg-primary px-6 py-2 text-primary-foreground hover:opacity-90"
        onClick={() => reset()}
        type="button"
      >
        Try again
      </button>
      <a href="/" className="mt-4 block text-sm text-primary underline underline-offset-4">Back to home</a>
      </div>
    </main>
  );
}
