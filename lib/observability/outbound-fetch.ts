import 'server-only';

import { SpanKind, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api';

/** Next.js traces its own fetches and the Stripe SDK is traced by the HTTP instrumentation, but a plain
 * `fetch` to the email and image vendors leaves no trace, so a failing vendor was invisible. This wrapper
 * records one CLIENT span per call carrying only the vendor name, its fixed domain and the HTTP status
 * (never the URL path, query, headers, body or any error text, which can hold account names, keys or
 * recipient addresses). The attribute names match the ones the HTTP instrumentation gives Stripe calls
 * (`url.domain`, `http.status_code`), so a single New Relic alert and dashboard widget cover all three. */
export type OutboundService = 'brevo' | 'cloudinary';

const SERVICE_DOMAINS: Record<OutboundService, string> = { brevo: 'api.brevo.com', cloudinary: 'api.cloudinary.com' };

export async function tracedFetch(
  service: OutboundService,
  url: string,
  init: RequestInit,
  tracer: Tracer = trace.getTracer('idoc.outbound'),
): Promise<Response> {
  const domain = SERVICE_DOMAINS[service];
  const method = init.method ?? 'GET';
  return tracer.startActiveSpan(
    `${method} ${domain}`,
    { kind: SpanKind.CLIENT, attributes: { 'idoc.integration': service, 'url.domain': domain, 'http.request.method': method } },
    async (span) => {
      try {
        const response = await fetch(url, init);
        span.setAttribute('http.status_code', response.status);
        if (response.status >= 400) span.setStatus({ code: SpanStatusCode.ERROR });
        return response;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
