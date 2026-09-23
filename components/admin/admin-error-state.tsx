'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { reportClientError } from '@/lib/report-client-error';

export function AdminErrorState({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError(error); }, [error]);
  return <main className="space-y-4 px-5 py-8 lg:px-8" role="alert">
    <h1 className="text-2xl font-semibold">Administration area unavailable</h1>
    <p className="text-muted-foreground">This page could not be loaded. No changes were made.</p>
    {error.digest && <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>}
    <div className="flex gap-4">
      <button className="rounded bg-primary px-4 py-2 text-primary-foreground" onClick={reset} type="button">Try again</button>
      <Link className="self-center underline" href="/admin">Admin Dashboard</Link>
    </div>
  </main>;
}
