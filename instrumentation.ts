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
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      // Operational diagnostics contain only configuration states, never secret values.
      console.info('[idoc.otel] initialization', {
        endpointConfigured: Boolean(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT),
        headerConfigured: Boolean(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS),
        directExporterEnabled: Boolean(traceExporter),
      });
    }
    if (traceExporter) {
      // Preserve existing trace delivery and emit one OTLP delta histogram
      // for the same server spans. Do not duplicate HTTP request spans.
      const { sendServerDurationMetrics } = await import('./lib/observability/otlp-server-metrics');
      const originalExport = traceExporter.export.bind(traceExporter);
      const apiKey = /^api-key=([^,\r\n]+)$/.exec(
        process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS || ''
      )?.[1];
      if (apiKey) {
        traceExporter.export = (spans, callback) => {
          // Metrics errors are best-effort and must never suppress traces.
          const metrics = sendServerDurationMetrics(spans, apiKey);
          originalExport(spans, result => {
            void metrics.then(() => callback(result));
          });
        };
      }
    }
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
