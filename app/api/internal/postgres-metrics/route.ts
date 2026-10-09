import 'server-only';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { postgresMetricsPayload, readPostgresMetrics } from '@/lib/observability/postgres-metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Manual validation ONLY on the actual staging branch. Never registered in
// vercel.json crons, and disabled in PR previews and production.
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview' ||
      process.env.VERCEL_GIT_COMMIT_REF !== 'staging') {
    return new NextResponse(null, { status: 404 });
  }
  const expected = cronSecretForServer();
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return new NextResponse(null, { status: 401 });
  }
  const configured = process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS ?? '';
  const match = /^api-key=([^,\r\n]+)$/.exec(configured);
  if (!match) return NextResponse.json({ status: 'not_configured' }, { status: 503 });
  try {
    const metrics = await readPostgresMetrics();
    const response = await fetch('https://otlp.nr-data.net/v1/metrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': match[1] },
      body: JSON.stringify(postgresMetricsPayload(metrics, Date.now())),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!response.ok) {
      console.warn('[postgres.metrics] export failed', { status: response.status });
      return NextResponse.json({ status: 'export_failed' }, { status: 502 });
    }
    return NextResponse.json({ status: 'accepted' });
  } catch {
    console.warn('[postgres.metrics] collection unavailable');
    return NextResponse.json({ status: 'unavailable' }, { status: 503 });
  }
}
