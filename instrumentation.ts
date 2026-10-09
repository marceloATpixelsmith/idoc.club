import * as Sentry from '@sentry/nextjs';
import { OTLPHttpProtoTraceExporter, registerOTel } from '@vercel/otel';

function newRelicTraceExporter() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const header = process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS;

  // Only enable direct export for the explicitly configured New Relic endpoint.
  // Never send ingest credentials to an arbitrary URL.
  if (endpoint !== 'https://otlp.nr-data.net/v1/traces' || !header) return undefined;
  const match = /^api-key=([^,\r\n]+)$/.exec(header);
  if (!match) return undefined;

  return new OTLPHttpProtoTraceExporter({
    url: endpoint,
    headers: { 'api-key': match[1] },
  });
}

export async function register() {
  if (process.env.VERCEL === '1') {
    // A custom exporter is not suppressed when Vercel's Trace Drain is active.
    // The team Trace Drain independently preserves Vercel's platform spans.
    const traceExporter = process.env.NEXT_RUNTIME === 'nodejs'
      ? newRelicTraceExporter()
      : undefined;
    registerOTel({
      serviceName: 'idoc.club',
      // Override automatic processors to prevent duplicate OTLP export when the drain changes state.
      ...(traceExporter ? { traceExporter, spanProcessors: [] } : {}),
      // Do not export provider API keys, addresses, or query strings in fetch URLs.
      instrumentationConfig: { fetch: { ignoreUrls: [/.*/] } },
    });
  }
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
}

export const onRequestError = Sentry.captureRequestError;
