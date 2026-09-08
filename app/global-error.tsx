'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/report-client-error';

// Catches errors the root layout itself throws (or anything the SWR fallback it wires up
// rejects with) — replaces the entire document, so it must render its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-[100dvh] bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-3xl border border-border bg-card px-6 py-12 text-center shadow-sm sm:px-12">
          <div className="mx-auto mb-7 flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <span className="text-2xl font-semibold">!</span>
          </div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">IDOC</p>
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
      </body>
    </html>
  );
}
