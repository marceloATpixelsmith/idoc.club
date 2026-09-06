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
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-medium text-foreground mb-2">Something went wrong</h1>
          <p className="text-muted-foreground mb-6">
            An unexpected error occurred. It has been reported automatically.
            {error.digest ? <span className="block text-xs text-muted-foreground mt-2">Reference: {error.digest}</span> : null}
          </p>
          <button
            className="rounded-full bg-primary px-6 py-2 text-primary-foreground hover:opacity-90"
            onClick={() => reset()}
            type="button"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
