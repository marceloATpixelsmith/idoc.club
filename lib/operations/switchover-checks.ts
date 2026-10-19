import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import journal from '@/lib/db/migrations/meta/_journal.json';
import { getDatabaseSchemaName } from '@/lib/db/schema-name';
import { legacyImportEnabled } from '@/lib/legacy-import/dry-run';
import { getStripeServerClient } from '@/lib/payments/stripe-client';
import { REPLAYABLE_EVENT_TYPES } from '@/lib/payments/webhook-handlers';
import { memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';
import { hostOf, type FinalInputs, type SwitchoverInputs } from './switchover-checks-core';

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const rows = await db.execute<{ n: number }>(query);
  return Number([...rows][0]?.n ?? 0);
}

async function webhookState(baseUrl: string | undefined): Promise<SwitchoverInputs['webhook']> {
  try {
    const endpoints = await getStripeServerClient().webhookEndpoints.list({ limit: 100 });
    const target = baseUrl ? `${baseUrl.replace(/\/$/, '')}/api/stripe/webhook` : '';
    const found = endpoints.data.find((endpoint) => endpoint.url === target);
    if (!found) return { missingEvents: [], state: 'missing' };
    if (found.status !== 'enabled') return { missingEvents: [], state: 'disabled' };
    const missing = found.enabled_events.includes('*') ? [] : REPLAYABLE_EVENT_TYPES.filter((type) => !found.enabled_events.includes(type));
    return { missingEvents: missing, state: missing.length === 0 ? 'ok' : 'partial' };
  } catch {
    return { missingEvents: [], state: 'unavailable' };
  }
}

/** Reads this deployment's own state only (settings by presence and host, never values). Read-only. */
export async function gatherSwitchoverInputs(): Promise<SwitchoverInputs> {
  const env = process.env;
  const schema = getDatabaseSchemaName();
  const newest = async (name: string): Promise<number | null> => {
    try { return await count(sql`select coalesce(max(created_at), 0)::bigint::float8 as n from ${sql.identifier(name)}.__drizzle_migrations`); } catch { return null; }
  };
  const ledgerNewest = await newest(schema);
  const stagingNewest = schema === 'idoc_production' ? await newest('idoc_staging') : undefined;
  // Administrators are the operators of this page, so they are not test data.
  const nonAdmin = (column: string) => sql.raw(`not exists (select 1 from application_roles r where r.user_id = ${column} and r.revoked_at is null and r.role in ('super_admin', 'administrator'))`);
  const [users, profiles, subscriptions, legacyImports] = await Promise.all([
    count(sql`select count(*)::int as n from users u where ${nonAdmin('u.id')}`), count(sql`select count(*)::int as n from profiles p where ${nonAdmin('p.user_id')}`),
    count(sql`select count(*)::int as n from subscriptions s join profiles p on p.id = s.profile_id where ${nonAdmin('p.user_id')}`), count(sql`select count(*)::int as n from audit_log where action = 'admin.legacy_import.import'`),
  ]);
  const keyMode = /^(?:sk|rk)_(live|test)_/.exec(env.STRIPE_SECRET_KEY?.trim() ?? '')?.[1] as 'live' | 'test' | undefined;
  return {
    baseUrlHost: hostOf(env.BASE_URL), brevoWebhookKeyPresent: Boolean(env.BREVO_WEBHOOK_KEY?.trim()), counts: { legacyImports, profiles, subscriptions, users }, googleRedirectHost: hostOf(env.GOOGLE_OAUTH_REDIRECT_URI),
    holdOn: memberCommunicationsDisabled(), ledgerNewest, journalNewest: Math.max(...journal.entries.map((entry) => entry.when)), stagingNewest, legacyImportEnabled: legacyImportEnabled(),
    legacyKeyPresent: Boolean(env.LEGACY_STRIPE_SECRET_KEY?.trim()), qstashHost: hostOf(env.QSTASH_CALLBACK_BASE_URL),
    reconciliationLiveEnabled: env.RECONCILIATION_LIVE_STRIPE_ACTIONS === 'enabled', schema, stripeKeyMode: keyMode ?? null,
    webhook: await webhookState(env.BASE_URL), webhookSecretPresent: Boolean(env.STRIPE_WEBHOOK_SECRET?.trim()),
  };
}

async function latestAudit(action: string): Promise<{ at: string; data: Record<string, number> } | null> {
  const rows = [...await db.execute<{ at: string; data: Record<string, number> | null }>(sql`select created_at::text as at, after_json as data from audit_log where action = ${action} order by created_at desc limit 1`)];
  return rows[0] ? { at: rows[0].at, data: rows[0].data ?? {} } : null;
}

/** End-state inputs for after the import, replay and first scan. Read-only. */
export async function gatherFinalInputs(): Promise<FinalInputs> {
  const env = process.env;
  const pending = (table: string, extra = '') => count(sql.raw(`select count(*)::int as n from ${table} where sent_at is null and dead_lettered_at is null${extra}`));
  const failed = (table: string) => count(sql.raw(`select count(*)::int as n from ${table} where dead_lettered_at is not null and coalesce(last_error_code, '') <> 'member_launch_hold'`));
  const [importRun, replayRun, scan, users, profiles, payments, byStatus, findings, held, events, p1, p2, p3, p4, f1, f2, f3, f4] = await Promise.all([
    latestAudit('admin.legacy_import.import'), latestAudit('admin.stripe_event_replay.applied'), latestAudit('reconciliation.scan_resolution_summary'),
    count(sql`select count(*)::int as n from users`), count(sql`select count(*)::int as n from profiles`), count(sql`select count(*)::int as n from payments`),
    db.execute<{ status: string; n: number }>(sql`select status, count(*)::int as n from subscriptions group by status`),
    db.execute<{ kind: string; n: number }>(sql`select kind, count(*)::int as n from reconciliation_findings group by kind`),
    count(sql`select count(*)::int as n from reconciliation_findings where kind = 'status_conflict' and details ->> 'reason' = 'member_launch_hold'`),
    count(sql`select count(*)::int as n from stripe_events where created_at > now() - interval '24 hours'`),
    pending('account_delivery_outbox', ' and terminal_at is null'), pending('auth_security_notification_outbox'), pending('notification_outbox'), pending('operational_alert_outbox'),
    failed('account_delivery_outbox'), failed('auth_security_notification_outbox'), failed('notification_outbox'), failed('operational_alert_outbox'),
  ]);
  const webhook = await webhookState(env.BASE_URL);
  const keyMode = /^(?:sk|rk)_(live|test)_/.exec(env.STRIPE_SECRET_KEY?.trim() ?? '')?.[1] as 'live' | 'test' | undefined;
  return {
    deadLetteredOther: f1 + f2 + f3 + f4, heldEventsPending: held, hold: memberCommunicationsDisabled(),
    importRun: importRun ? { at: importRun.at, imported: importRun.data.imported ?? 0, payments: importRun.data.payments ?? 0, subscriptions: importRun.data.subscriptions ?? 0 } : null,
    keyMode: keyMode ?? null, legacyImportEnabled: legacyImportEnabled(), legacyKeyPresent: Boolean(env.LEGACY_STRIPE_SECRET_KEY?.trim()), liveActionsEnabled: env.RECONCILIATION_LIVE_STRIPE_ACTIONS === 'enabled',
    members: { payments, profiles, subscriptionsByStatus: Object.fromEntries([...byStatus].map((row) => [row.status, row.n])), users },
    openFindings: Object.fromEntries([...findings].map((row) => [row.kind, row.n])), outboxPending: p1 + p2 + p3 + p4,
    replayRun: replayRun ? { at: replayRun.at, failed: replayRun.data.failedCount ?? 0, processed: replayRun.data.processed ?? 0 } : null,
    scanAt: scan?.at ?? null, webhook: webhook.state, webhookEventsLast24h: events,
  };
}
