import 'server-only';

import { trace, type Span } from '@opentelemetry/api';

/** The signed QStash worker route already has one server span per job run (its HTTP status and duration
 * feed the existing job alerts). This adds the in-application result to that same span so a job that
 * "succeeds" with HTTP 200 but delivers nothing, retries, or dead-letters is visible in New Relic:
 * `job.name`, `job.retried` (QStash's own retry counter) and `job.result.<count>` for each plain number
 * the job's JSON summary reports (delivered, retryable, deadLettered, failed, processed, ...).
 * Only the job name (a fixed, code-defined identifier) and non-negative integer counts are recorded:
 * never a response body, message, identifier, address or error text. */
const MAX_RESULT_COUNTS = 12;

export function jobSpanAttributes(job: string, retriedHeader: string | null, summary: unknown): Record<string, string | number> {
  const attributes: Record<string, string | number> = { 'job.name': job };
  const retried = retriedHeader === null ? NaN : Number(retriedHeader);
  if (Number.isSafeInteger(retried) && retried >= 0 && retried <= 100) attributes['job.retried'] = retried;
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    let counts = 0;
    for (const [key, value] of Object.entries(summary as Record<string, unknown>)) {
      if (counts >= MAX_RESULT_COUNTS) break;
      if (!/^[a-zA-Z]{1,24}$/.test(key)) continue;
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) continue;
      attributes[`job.result.${key}`] = value;
      counts += 1;
    }
  }
  return attributes;
}

/** Never throws and never alters the response: telemetry must not change job behaviour. */
export async function recordJobResult(job: string, request: Request, response: Response, span: Span | undefined = trace.getActiveSpan()): Promise<void> {
  try {
    if (!span) return;
    let summary: unknown;
    if (response.headers.get('content-type')?.includes('application/json')) {
      try { summary = await response.clone().json(); } catch { summary = undefined; }
    }
    span.setAttributes(jobSpanAttributes(job, request.headers.get('upstash-retried'), summary));
  } catch {
    // Best-effort only.
  }
}
