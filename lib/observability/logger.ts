import 'server-only';

import { currentRequestId } from './request-id.ts';

/** Structured, categorical operational logging (docs/21 AUTH-LOG-003): every call site logs a static
 * event name plus a coarse, non-sensitive metadata object -- never raw request/response bodies,
 * exceptions, or secret values (that discipline is unchanged; this only adds a correlation ID on
 * top). Every line is tagged with the current request's correlation ID (docs/21 AUTH-LOG-004) so an
 * incident investigation can grep logs for one ID and see everything a single request did, without a
 * full APM/tracing vendor integration. */
async function log(sink: (...args: unknown[]) => void, event: string, meta: Record<string, unknown> = {}) {
  const requestId = await currentRequestId();
  sink(event, { requestId, ...meta });
}

export const logWarn = (event: string, meta?: Record<string, unknown>) => log(console.warn, event, meta);
export const logError = (event: string, meta?: Record<string, unknown>) => log(console.error, event, meta);
