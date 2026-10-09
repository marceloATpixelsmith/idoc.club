import * as Sentry from '@sentry/nextjs';
import { registerOTel } from '@vercel/otel';

export async function register() {
  // Vercel exports these application spans through the existing team trace drain.
  if (process.env.VERCEL === '1') registerOTel({
    serviceName: 'idoc.club',
    // Outbound URLs may contain address data, coordinates, or provider API keys.
    // Never export these full URLs as OpenTelemetry fetch spans.
    instrumentationConfig: { fetch: { ignoreUrls: [/.*/] } },
  });
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
}

export const onRequestError = Sentry.captureRequestError;
