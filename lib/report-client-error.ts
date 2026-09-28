import * as Sentry from '@sentry/nextjs';

/** Reports a boundary-caught exception directly to Sentry. The occurrence-only IDOC endpoint is
 * retained to provide the runtime-log correlation reference shown to support; error details never
 * pass through that endpoint. */
export async function reportClientError(error: Error & { digest?: string }): Promise<string | null> {
  console.error(error);
  let requestId: string | null = null;
  try {
    const response = await fetch('/api/client-error', {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (response.ok) {
      const result: unknown = await response.json();
      if (result && typeof result === 'object' && 'requestId' in result) {
        const candidate = result.requestId;
        requestId = typeof candidate === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(candidate) ? candidate : null;
      }
    }
  } catch {
    // Sentry capture must still happen if the occurrence-only correlation request fails.
  }
  Sentry.withScope((scope) => {
    if (requestId) {
      scope.setTag('idoc_request_id', requestId);
      scope.setContext('idoc', { request_id: requestId });
    }
    Sentry.captureException(error);
  });
  return requestId;
}
