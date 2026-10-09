import 'server-only';

import { escapeHtml, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { sendTransactionalEmail } from '@/lib/notifications/brevo-transactional';
import { taggedSubject } from '@/lib/notifications/alert-severity';
import { logError, logInfo } from './logger';
import { toErrorRows, toSlowRows, type HealthRow } from './new-relic-health-rows.ts';

// Weekly digest of server-side errors and slow routes for the dedicated `idoc.club` New Relic
// service, run by the QStash `new-relic-weekly-health-check` schedule. It reads only aggregate
// counts and templated route names (`http.route`), never URLs, users or span payloads, so no member
// data reaches the log line or the email. Read access uses a dedicated read-only user key
// (`NEW_RELIC_QUERY_KEY`); the ingest and deployment-marker keys are never reused here.

const NERDGRAPH_URL = 'https://api.newrelic.com/graphql';
const REQUEST_TIMEOUT_MS = 20_000;
const TOP_ROWS = 10;
const SERVICE = `service.name = 'idoc.club'`;

const ERROR_QUERY = `SELECT count(*) AS errors FROM Span WHERE ${SERVICE} AND span.kind = 'server' AND otel.status_code = 'ERROR' FACET http.route SINCE 7 days ago LIMIT ${TOP_ROWS}`;
const SLOW_QUERY = `SELECT percentile(duration.ms, 95) AS p95, count(*) AS requests FROM Span WHERE ${SERVICE} AND span.kind = 'server' FACET http.route SINCE 7 days ago LIMIT ${TOP_ROWS}`;

async function nrql(accountId: string, key: string, query: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(NERDGRAPH_URL, {
    body: JSON.stringify({
      query: 'query($id: Int!, $nrql: Nrql!) { actor { account(id: $id) { nrql(query: $nrql) { results } } } }',
      variables: { id: Number(accountId), nrql: query },
    }),
    cache: 'no-store',
    headers: { 'API-Key': key, 'content-type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`New Relic query failed (${response.status})`);
  const body = await response.json() as { data?: { actor?: { account?: { nrql?: { results?: Record<string, unknown>[] } } } }; errors?: unknown[] };
  const results = body.data?.actor?.account?.nrql?.results;
  if (body.errors?.length || !Array.isArray(results)) throw new Error('New Relic query returned an error');
  return results;
}

function table(rows: HealthRow[], valueLabel: string, format: (row: HealthRow) => string): string {
  if (!rows.length) return '<p>None in the last 7 days.</p>';
  const cells = rows.map((row) => `<tr><td>${escapeHtml(row.route)}</td><td>${escapeHtml(format(row))}</td></tr>`).join('');
  return `<table cellpadding="6"><tr><th align="left">Route</th><th align="left">${escapeHtml(valueLabel)}</th></tr>${cells}</table>`;
}

/** Fails (throws) on missing configuration or a New Relic error so QStash retries and the route
 * records `new_relic_health_check_failed`; email delivery trouble is logged but does not retry the
 * whole run, since the log line already carries the result. */
export async function runNewRelicHealthCheck(): Promise<{ emailed: number; errorRoutes: number; slowRoutes: number }> {
  const key = process.env.NEW_RELIC_QUERY_KEY;
  const accountId = process.env.NEW_RELIC_ACCOUNT_ID;
  if (!key || !accountId || !/^\d+$/.test(accountId)) throw new Error('New Relic health check is not configured.');

  const [errorResults, slowResults] = await Promise.all([nrql(accountId, key, ERROR_QUERY), nrql(accountId, key, SLOW_QUERY)]);
  const errors = toErrorRows(errorResults);
  const slow = toSlowRows(slowResults);

  await logInfo('new_relic_health_check_completed', {
    ...(errors.length ? { errorSpanGroups: errors.length } : {}),
    ...(slow.length ? { slowRoutes: slow.length } : {}),
  });

  const to = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
  if (!to) return { emailed: 0, errorRoutes: errors.length, slowRoutes: slow.length };
  const environment = process.env.VERCEL_ENV ?? 'unknown';
  try {
    await sendTransactionalEmail({
      html: renderTransactionalEmail({
        bodyHtml: `<p>Server-side activity for <b>idoc.club</b> in New Relic over the last 7 days (runtime: ${escapeHtml(environment)}).</p>
<h3>Routes with errors</h3>${table(errors, 'Error spans', (row) => String(row.value))}
<h3>Slowest routes (p95)</h3>${table(slow, 'p95 (ms)', (row) => `${Math.round(row.value)} ms over ${Math.round(row.requests ?? 0)} requests`)}`,
        footerNote: 'IDOC operational monitoring.',
        heading: 'Weekly New Relic health check',
      }),
      subject: taggedSubject('operations.new_relic_weekly_health', `IDOC: weekly New Relic health check (${environment})`),
      to,
    }, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { emailed: 1, errorRoutes: errors.length, slowRoutes: slow.length };
  } catch {
    await logError('new_relic_health_check_failed');
    return { emailed: 0, errorRoutes: errors.length, slowRoutes: slow.length };
  }
}
