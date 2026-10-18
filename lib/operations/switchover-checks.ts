import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import journal from '@/lib/db/migrations/meta/_journal.json';
import { getDatabaseSchemaName } from '@/lib/db/schema-name';
import { legacyImportEnabled } from '@/lib/legacy-import/dry-run';
import { getStripeServerClient } from '@/lib/payments/stripe-client';
import { REPLAYABLE_EVENT_TYPES } from '@/lib/payments/webhook-handlers';
import { memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';
import { hostOf, evaluateSwitchover, type SwitchoverCheck, type SwitchoverInputs } from './switchover-checks-core';

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

/** Reads this deployment's own state only (settings by presence and host, never values) and runs the pure checklist. Read-only. */
export async function runSwitchoverChecks(): Promise<SwitchoverCheck[]> {
  const env = process.env;
  const schema = getDatabaseSchemaName();
  let ledgerApplied: number | null = null;
  try { ledgerApplied = await count(sql`select count(*)::int as n from ${sql.identifier(schema)}.__drizzle_migrations`); } catch { /* reported as unreadable */ }
  const [users, profiles, subscriptions, legacyImports] = await Promise.all([
    count(sql`select count(*)::int as n from users`), count(sql`select count(*)::int as n from profiles`),
    count(sql`select count(*)::int as n from subscriptions`), count(sql`select count(*)::int as n from audit_log where action = 'admin.legacy_import.import'`),
  ]);
  const keyMode = /^(?:sk|rk)_(live|test)_/.exec(env.STRIPE_SECRET_KEY?.trim() ?? '')?.[1] as 'live' | 'test' | undefined;
  return evaluateSwitchover({
    baseUrlHost: hostOf(env.BASE_URL), counts: { legacyImports, profiles, subscriptions, users }, googleRedirectHost: hostOf(env.GOOGLE_OAUTH_REDIRECT_URI),
    holdOn: memberCommunicationsDisabled(), ledgerApplied, ledgerExpected: journal.entries.length, legacyImportEnabled: legacyImportEnabled(),
    legacyKeyPresent: Boolean(env.LEGACY_STRIPE_SECRET_KEY?.trim()), qstashHost: hostOf(env.QSTASH_CALLBACK_BASE_URL),
    reconciliationLiveEnabled: env.RECONCILIATION_LIVE_STRIPE_ACTIONS === 'enabled', schema, stripeKeyMode: keyMode ?? null,
    webhook: await webhookState(env.BASE_URL), webhookSecretPresent: Boolean(env.STRIPE_WEBHOOK_SECRET?.trim()),
  });
}
