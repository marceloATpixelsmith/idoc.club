import 'server-only';

import { headers } from 'next/headers';
import { REQUEST_ID_HEADER } from './request-id-header.ts';

/** The correlation ID for the current request, set by `middleware.ts` on every request before any
 * application code runs (docs/21 AUTH-LOG-004). Only ever read from the request-header copy
 * middleware itself forwarded downstream -- a client cannot influence this value. Several call sites
 * that log through this (email/OTP delivery, account recovery, the cron workers) are also invoked
 * directly by this repository's integration tests outside any real Next.js request, where `headers()`
 * itself throws ("called outside a request scope") rather than returning an empty result -- logging
 * must never be what makes an unrelated operation fail, so that specific case is the one thing this
 * catches and falls back to a fixed placeholder for; any other error still propagates. */
export async function currentRequestId(): Promise<string> {
  try {
    const requestHeaders = await headers();
    return requestHeaders.get(REQUEST_ID_HEADER) ?? 'no-request-id';
  } catch (error) {
    if (error instanceof Error && error.message.includes('was called outside a request scope')) return 'no-request-id';
    throw error;
  }
}
