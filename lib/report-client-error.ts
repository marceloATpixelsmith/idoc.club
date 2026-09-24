/**REPORTS AN OCCURRENCE WITHOUT SENDING ERROR TEXT TO THE SERVER. RETURNS ITS LOG REFERENCE WHEN AVAILABLE.*/
export async function reportClientError(error: Error & { digest?: string }): Promise<string | null> {
  console.error(error);
  try {
    const response = await fetch('/api/client-error', {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) return null;
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('requestId' in result)) return null;
    const requestId = result.requestId;
    return typeof requestId === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(requestId) ? requestId : null;
  } catch {
    return null;
  }
}
