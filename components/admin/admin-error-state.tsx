'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { reportClientError } from '@/lib/report-client-error';

export function AdminErrorState({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [context, setContext] = useState<{ path: string; time: string } | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setContext({ path: window.location.pathname, time: new Date().toISOString() });
    setReportId(null);
    setCopied(false);
    void reportClientError(error).then((id) => { if (active) setReportId(id); });
    return () => { active = false; };
  }, [error]);

  const diagnostic = [
    `Page: ${context?.path ?? 'Loading...'}`,
    `Time (UTC): ${context?.time ?? 'Loading...'}`,
    `Log reference: ${reportId ?? 'Unavailable'}`,
    `Server error digest: ${error.digest ?? 'None provided'}`,
    `Error type: ${error.name || 'Error'}`,
    `Message: ${error.message || 'No message provided'}`,
    error.stack ? `Browser stack:\n${error.stack}` : 'Browser stack: Unavailable',
  ].join('\n');

  return (
    <main className="space-y-5 px-5 py-8 lg:px-8" role="alert">
      <h1 className="text-2xl font-semibold">Administration area unavailable</h1>
      <p className="text-muted-foreground">The page failed to load. If you submitted a change, check whether it was saved before trying again.</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="font-semibold">Page</dt><dd className="break-all">{context?.path ?? 'Loading...'}</dd>
        <dt className="font-semibold">Time (UTC)</dt><dd>{context?.time ?? 'Loading...'}</dd>
        <dt className="font-semibold">Log reference</dt><dd className="break-all">{reportId ?? 'Unavailable'}</dd>
        <dt className="font-semibold">Server error digest</dt><dd className="break-all">{error.digest ?? 'None provided'}</dd>
      </dl>
      <details className="rounded border border-border p-4">
        <summary className="cursor-pointer font-medium">Technical details</summary>
        <p className="my-3 text-sm text-muted-foreground">
          Server errors are masked by Next.js in production. Match the log reference, digest, page, and time against Vercel runtime logs. Review these details for personal information before sharing them.
        </p>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{diagnostic}</pre>
        <button
          className="mt-3 rounded border border-border px-3 py-2 text-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(diagnostic);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          type="button"
        >
          {copied ? 'Copied' : 'Copy diagnostic details'}
        </button>
      </details>
      <div className="flex flex-wrap gap-4">
        <button className="rounded bg-primary px-4 py-2 text-primary-foreground" onClick={reset} type="button">Try again</button>
        <Link className="self-center underline" href="/admin">Admin Dashboard</Link>
      </div>
    </main>
  );
}
