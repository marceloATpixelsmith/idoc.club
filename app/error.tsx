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
    <main className="max-w-md mx-auto px-4 py-24 text-center">
      <h1 className="text-2xl font-medium text-gray-900 mb-2">Something went wrong</h1>
      <p className="text-gray-600 mb-6">
        An unexpected error occurred. It has been reported automatically.
        {error.digest ? <span className="block text-xs text-gray-400 mt-2">Reference: {error.digest}</span> : null}
      </p>
      <button
        className="rounded-full bg-orange-500 px-6 py-2 text-white hover:bg-orange-600"
        onClick={() => reset()}
        type="button"
      >
        Try again
      </button>
    </main>
  );
}
