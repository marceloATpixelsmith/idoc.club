import 'server-only';

import { currentRequestId } from './request-id.ts';
import { SECURITY_EVENT_TAXONOMY, type SecurityEventDefinition, type SecurityEventName } from './security-events.ts';

/** Structured, categorical operational logging (AUTH-LOG-003): every call site logs a stable,
 * pre-registered event name (AUTH-LOG-001 -- see security-events.ts, the closed taxonomy this
 * function's `event` parameter type is derived from) plus a coarse, non-sensitive metadata object
 * -- never raw request/response bodies, exceptions, or secret values (that discipline is
 * unchanged). Every line is tagged with the current request's correlation ID (docs/21 AUTH-LOG-004)
 * and, from the taxonomy, its category and resource attribution -- callers never restate either, so
 * they can't drift from the registered definition. */
const MAX_META_ENTRIES = 16;

/** AUTH-LOG-003's "redacted at ingestion" requirement, made structural rather than left to caller
 * discipline: only flat primitives may reach a log line (an object/array could otherwise smuggle an
 * unbounded, unreviewed payload -- e.g. a raw request/response body -- past every call site's own
 * intent), and an oversized string is truncated the same way app/api/client-error/route.ts already
 * truncates untrusted client-reported text, rather than forwarded whole. */
function minimizeMeta(event: SecurityEventName, meta: Record<string, unknown>): Record<string, unknown> | null {
  const definition: SecurityEventDefinition = SECURITY_EVENT_TAXONOMY[event];
  const schema = definition.metadata;
  const entries = Object.entries(meta).slice(0, MAX_META_ENTRIES);
  const minimized: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const rule = schema?.[key as keyof typeof schema];
    if (!rule) continue;
    if (rule === 'positiveInteger') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
      minimized[key] = value;
    } else if ((rule as readonly unknown[]).includes(value)) minimized[key] = value;
  }
  if (definition.attribution === 'subject' && !('subjectId' in minimized)) return null;
  return minimized;
}

async function log(sink: (...args: unknown[]) => void, event: SecurityEventName, meta: Record<string, unknown> = {}) {
  const requestId = await currentRequestId();
  const { attribution, category, resource, retentionClass } = SECURITY_EVENT_TAXONOMY[event];
  const safeMeta = minimizeMeta(event, meta);
  // An invalid subject-attributed event is suppressed rather than leaking or inventing identity.
  if (!safeMeta) return;
  // category/resource/retentionClass are placed last so the taxonomy's registered values always
  // win over anything a caller's meta might (redundantly, or by drift) also supply under those keys.
  sink(event, { requestId, ...safeMeta, attribution, category, resource, retentionClass });
}

export const logWarn = (event: SecurityEventName, meta?: Record<string, unknown>) => log(console.warn, event, meta);
export const logError = (event: SecurityEventName, meta?: Record<string, unknown>) => log(console.error, event, meta);
