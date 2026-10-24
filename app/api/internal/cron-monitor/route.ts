import 'server-only';
import { NextResponse } from 'next/server';
import { cronMonitorTokenForServer } from '@/lib/runtime/configuration';
import { boundedInteger, bearerMatches, MONITOR_MAX_DAYS, MONITOR_MAX_NOTICES } from '@/lib/observability/cron-monitor-core';
import { readCronMonitor } from '@/lib/observability/cron-monitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only feed for the owner's cron monitoring dashboard. It uses its own CRON_MONITOR_TOKEN, never CRON_SECRET, so a
// leaked dashboard credential can read masked outbox figures but cannot trigger any Cron route. Not listed in
// vercel.json and not reachable during maintenance mode (middleware answers 503 first).
export async function GET(request: Request) {
  let expected: string;
  try { expected = cronMonitorTokenForServer(); } catch {
    return NextResponse.json({ status: 'not_configured' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  if (!bearerMatches(request.headers.get('authorization'), expected)) {
    return new NextResponse(null, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  const params = new URL(request.url).searchParams;
  const days = boundedInteger(params.get('days'), MONITOR_MAX_DAYS, 1, MONITOR_MAX_DAYS);
  const limit = boundedInteger(params.get('limit'), MONITOR_MAX_NOTICES, 1, MONITOR_MAX_NOTICES);
  try {
    return NextResponse.json(await readCronMonitor(days, limit), { headers: { 'cache-control': 'no-store' } });
  } catch {
    console.warn('[cron.monitor] read unavailable');
    return NextResponse.json({ status: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
