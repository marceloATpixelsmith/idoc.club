// Pure evaluation of the production switchover checklist (docs/30). The server module gathers the inputs; nothing here reads the environment or the database.

export type SwitchoverInputs = {
  baseUrlHost: string | null;
  counts: { legacyImports: number; profiles: number; subscriptions: number; users: number };
  googleRedirectHost: string | null;
  holdOn: boolean;
  ledgerApplied: number | null;
  ledgerExpected: number;
  legacyImportEnabled: boolean;
  legacyKeyPresent: boolean;
  qstashHost: string | null;
  reconciliationLiveEnabled: boolean;
  schema: string;
  stripeKeyMode: 'live' | 'test' | null;
  webhook: { missingEvents: string[]; state: 'disabled' | 'missing' | 'ok' | 'partial' | 'unavailable' };
  webhookSecretPresent: boolean;
};

export type SwitchoverCheck = { detail: string; id: string; label: string; status: 'ok' | 'todo' | 'warn' };

const LIVE_HOSTS = ['idoc.club', 'www.idoc.club'];
const onLiveDomain = (host: string | null) => host !== null && LIVE_HOSTS.includes(host);

/** Hostname of a URL-shaped setting, or null when missing or malformed. Used for the three settings that must all name the live domain. */
export function hostOf(value: string | undefined): string | null {
  try { return value ? new URL(value).hostname : null; } catch { return null; }
}

export function evaluateSwitchover(input: SwitchoverInputs): SwitchoverCheck[] {
  const checks: SwitchoverCheck[] = [];
  const add = (id: string, label: string, status: SwitchoverCheck['status'], detail: string) => checks.push({ detail, id, label, status });

  if (input.schema !== 'idoc_production') {
    add('schema', 'Environment', 'warn', `This is ${input.schema}, not production. The checks below describe this environment, so run this page on production for the real answer.`);
  }

  add('migrations', 'Database migrations', input.ledgerApplied === null ? 'warn' : input.ledgerApplied === input.ledgerExpected ? 'ok' : 'todo',
    input.ledgerApplied === null ? 'The migration ledger could not be read.'
      : input.ledgerApplied === input.ledgerExpected ? `All ${input.ledgerExpected} migrations are applied.`
        : `${input.ledgerApplied} of ${input.ledgerExpected} migrations are applied. Approve the Auto-migrate Production Schema run in GitHub.`);

  const { users, profiles, subscriptions, legacyImports } = input.counts;
  const hasData = users + profiles + subscriptions > 0;
  add('data', 'Test data cleared', legacyImports > 0 ? 'warn' : hasData ? 'todo' : 'ok',
    legacyImports > 0 ? `A legacy import has already run here (${users} users, ${profiles} profiles, ${subscriptions} subscriptions now). A second import skips members already imported.`
      : hasData ? `${users} users, ${profiles} profiles and ${subscriptions} subscriptions exist. If they are only test data, clear them before importing.`
        : 'No members, profiles or subscriptions yet.');

  add('stripe-key', 'Stripe key mode', input.stripeKeyMode === null ? 'todo' : input.stripeKeyMode === 'live' ? 'ok' : 'todo',
    input.stripeKeyMode === null ? 'No valid STRIPE_SECRET_KEY is set.' : input.stripeKeyMode === 'live' ? 'STRIPE_SECRET_KEY is a live-mode key.'
      : 'STRIPE_SECRET_KEY is a test-mode key. Production on idoc.club needs the live key.');

  const webhook = input.webhook;
  add('webhook', 'Stripe webhook endpoint',
    webhook.state === 'ok' ? 'ok' : webhook.state === 'unavailable' ? 'warn' : 'todo',
    webhook.state === 'ok' ? 'An enabled endpoint for this site listens to every handled event type.'
      : webhook.state === 'unavailable' ? 'Stripe could not be read with the current key, so the endpoint could not be checked. Look in the Stripe dashboard.'
        : webhook.state === 'missing' ? 'No webhook endpoint points at this site\'s /api/stripe/webhook. Create it in the Stripe dashboard (keep it disabled until the switch).'
          : webhook.state === 'disabled' ? 'The endpoint exists but is disabled. Enable it at the switch (docs/30 step B5).'
            : `The endpoint is missing these event types: ${webhook.missingEvents.join(', ')}.`);
  add('webhook-secret', 'Webhook signing secret', input.webhookSecretPresent ? 'ok' : 'todo', input.webhookSecretPresent ? 'STRIPE_WEBHOOK_SECRET is set.' : 'STRIPE_WEBHOOK_SECRET is not set.');

  const domains: Array<[string, string, string | null]> = [['BASE_URL', 'base URL', input.baseUrlHost], ['GOOGLE_OAUTH_REDIRECT_URI', 'Google sign-in redirect', input.googleRedirectHost], ['QSTASH_CALLBACK_BASE_URL', 'QStash callback', input.qstashHost]];
  const stale = domains.filter(([, , host]) => !onLiveDomain(host));
  add('domain-settings', 'Settings name idoc.club', stale.length === 0 ? 'ok' : 'todo',
    stale.length === 0 ? 'BASE_URL, GOOGLE_OAUTH_REDIRECT_URI and QSTASH_CALLBACK_BASE_URL all use the live domain.'
      : `Still not on idoc.club: ${stale.map(([name, , host]) => `${name} (${host ?? 'not set'})`).join(', ')}. Change them at the switch (docs/30 step B3).`);

  add('import-switch', 'Legacy import switched on', input.legacyImportEnabled ? 'ok' : 'todo',
    input.legacyImportEnabled ? 'LEGACY_IMPORT_ENABLED is on.' : 'LEGACY_IMPORT_ENABLED is off. Turn it on for the import (docs/30 step B3).');
  add('import-key', 'Read-only Stripe key for the import', input.legacyKeyPresent ? 'ok' : 'todo',
    input.legacyKeyPresent ? 'LEGACY_STRIPE_SECRET_KEY is set. Remove it and revoke the key after the import.' : 'LEGACY_STRIPE_SECRET_KEY is not set. The import needs it for the live Stripe comparison.');

  add('hold', 'Member communications and billing hold', input.holdOn ? 'ok' : 'warn',
    input.holdOn ? 'The hold is on. Keep it on through the import; release it only at step B8.' : 'The hold is OFF: emails and live billing are active. Replay needs it off, the import needs it on.');
  add('safeguard', 'Live Stripe actions safeguard', input.reconciliationLiveEnabled ? 'warn' : 'ok',
    input.reconciliationLiveEnabled ? 'RECONCILIATION_LIVE_STRIPE_ACTIONS is enabled: a scan can now cancel subscriptions and delete customers in Stripe. Only keep it on once the import is verified.'
      : 'Off (default): reconciliation only simulates Stripe changes.');
  return checks;
}
