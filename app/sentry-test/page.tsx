'use client';

import * as Sentry from '@sentry/nextjs';
import { useState } from 'react';

export default function SentryVerificationPage() {
  const [status, setStatus] = useState('');

  function requireStagingHost() {
    if (window.location.hostname !== 'staging.idoc.club' && !window.location.hostname.endsWith('.vercel.app')) {
      throw new Error('Sentry verification is disabled on this host');
    }
  }

  function testBrowser() {
    setStatus('Browser test clicked; sending…');
    requireStagingHost();
    const error = new Error('IDOC_SENTRY_BROWSER_TEST');
    Sentry.captureException(error, { tags: { idoc_diagnostic: 'sentry-browser-test' } });
    setStatus('Browser test sent. Check Sentry Issues for IDOC_SENTRY_BROWSER_TEST.');
  }

  async function testServer() {
    setStatus('Server test clicked; sending…');
    requireStagingHost();
    const response = await fetch('/api/diagnostics/sentry-test', { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    setStatus(response.ok ? 'Server test sent. Check Sentry Issues for IDOC_SENTRY_SERVER_TEST.' : `Server test failed: ${body.error ?? response.status}`);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Sentry verification</h1>
      <p>Staging-only diagnostics. These controls send synthetic errors to Sentry and contain no member data.</p>
      <div className="flex gap-3">
        <button className="rounded border px-4 py-2" onClick={testBrowser}>Send browser test error</button>
        <button className="rounded border px-4 py-2" onClick={testServer}>Send server test error</button>
      </div>
      {status ? <p role="status">{status}</p> : null}
    </main>
  );
}
