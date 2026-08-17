/** Reports an error caught by a client error boundary so it's visible in server logs, not only in whichever browser happened to hit it. Best-effort — never throws. */
export function reportClientError(error: Error & { digest?: string }) {
  console.error(error);
  fetch('/api/client-error', {
    body: JSON.stringify({
      digest: error.digest,
      message: error.message,
      stack: error.stack,
      url: typeof window === 'undefined' ? '' : window.location.href,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }).catch(() => {});
}
