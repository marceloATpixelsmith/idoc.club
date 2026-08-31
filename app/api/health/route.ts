import 'server-only';

import { client } from '@/lib/db/drizzle';

// Minimal liveness/readiness probe for a load balancer or uptime monitor: confirms the process is
// up and the database is reachable, and nothing else. Deliberately unauthenticated (an infra
// prober cannot hold a session) and content-free beyond a status string -- no version, topology, or
// configuration detail -- matching this codebase's cron-response minimization convention (docs/07
// §12.1, AUTH-API-005).
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    await client`select 1`;
    return Response.json({ status: 'ok' }, { headers });
  } catch {
    return Response.json({ status: 'error' }, { headers, status: 503 });
  }
}
