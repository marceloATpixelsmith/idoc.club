// Pure evaluation of the production switchover checklist (docs/30). The server module gathers the inputs; nothing here reads the environment or the database.

export type SwitchoverInputs = {
  baseUrlHost: string | null;
  counts: { legacyImports: number; profiles: number; subscriptions: number; users: number };
  googleRedirectHost: string | null;
  holdOn: boolean;
  /** `created_at` of the newest row in this schema's migration ledger, the newest `when` in the code's journal, and the staging ledger's newest (null: unreadable; undefined: not applicable). */
  ledgerNewest: number | null;
  journalNewest: number;
  stagingNewest?: number | null;
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

  // Drizzle treats a migration as applied when the ledger's newest timestamp reaches its own, and a few historical entries were applied out of order, so the newest
  // timestamp (not a row count) is the identity that matters. The production ledger must also match staging's newest (docs/07 production migration rules).
  const ledgerState = input.ledgerNewest === null ? 'unreadable' : input.ledgerNewest < input.journalNewest ? 'behind' : input.ledgerNewest > input.journalNewest ? 'ahead' : 'current';
  const stagingDiffers = input.stagingNewest !== undefined && input.stagingNewest !== null && input.ledgerNewest !== null && input.stagingNewest !== input.ledgerNewest;
  const stagingUnreadable = input.stagingNewest === null;
  add('migrations', 'Database migrations', ledgerState === 'current' && !stagingDiffers && !stagingUnreadable ? 'ok' : ledgerState === 'behind' || stagingDiffers ? 'todo' : 'warn',
    ledgerState === 'unreadable' ? 'The migration ledger could not be read.'
      : ledgerState === 'behind' ? 'The newest applied migration is older than the newest in the code. Approve the Auto-migrate Production Schema run in GitHub.'
        : ledgerState === 'ahead' ? 'The ledger is ahead of this deployment\'s code. Deploy the matching code before continuing.'
          : stagingDiffers ? 'The newest migration here differs from the staging schema\'s. Production must match staging before the switchover.'
            : stagingUnreadable ? 'The code and this ledger agree, but the staging schema\'s ledger could not be read, so the match with staging is unverified. Check it in the migration workflow.'
            : 'The newest applied migration matches the code' + (input.stagingNewest === undefined ? '.' : ' and the staging schema.'));

  const { users, profiles, subscriptions, legacyImports } = input.counts;
  const hasData = users + profiles + subscriptions > 0;
  add('data', 'Test data cleared (administrators not counted)', legacyImports > 0 ? 'warn' : hasData ? 'todo' : 'ok',
    legacyImports > 0 ? `A legacy import has already run here (${users} users, ${profiles} profiles, ${subscriptions} subscriptions now). A second import skips members already imported.`
      : hasData ? `${users} non-administrator users, ${profiles} profiles and ${subscriptions} subscriptions exist. If they are only test data, clear them before importing.`
        : 'No members, profiles or subscriptions beyond the administrator accounts.');

  add('stripe-key', 'Stripe key mode', input.stripeKeyMode === null ? 'todo' : input.stripeKeyMode === 'live' ? 'ok' : 'todo',
    input.stripeKeyMode === null ? 'No valid STRIPE_SECRET_KEY is set.' : input.stripeKeyMode === 'live' ? 'STRIPE_SECRET_KEY is a live-mode key.'
      : 'STRIPE_SECRET_KEY is a test-mode key. Production on idoc.club needs the live key.');

  const webhook = input.webhook;
  add('webhook', 'Stripe webhook endpoint',
    webhook.state === 'ok' ? 'ok' : webhook.state === 'unavailable' ? 'warn' : 'todo',
    webhook.state === 'ok' ? 'An enabled endpoint for this site listens to every handled event type.'
      : webhook.state === 'unavailable' ? 'Stripe could not be read with the current key, so the endpoint could not be checked. Look in the Stripe dashboard.'
        : webhook.state === 'missing' ? 'No webhook endpoint points at this site\'s /api/stripe/webhook. Create it in the Stripe dashboard (keep it disabled until the switch).'
          : webhook.state === 'disabled' ? 'The endpoint exists but is disabled. Enable it after the import (docs/30 step B7).'
            : `The endpoint is missing these event types: ${webhook.missingEvents.join(', ')}.`);
  add('webhook-secret', 'Webhook signing secret', input.webhookSecretPresent ? 'ok' : 'todo', input.webhookSecretPresent ? 'STRIPE_WEBHOOK_SECRET is set.' : 'STRIPE_WEBHOOK_SECRET is not set.');

  const domains: Array<[string, string, string | null]> = [['BASE_URL', 'base URL', input.baseUrlHost], ['GOOGLE_OAUTH_REDIRECT_URI', 'Google sign-in redirect', input.googleRedirectHost], ['QSTASH_CALLBACK_BASE_URL', 'QStash callback', input.qstashHost]];
  const stale = domains.filter(([, , host]) => !onLiveDomain(host));
  add('domain-settings', 'Settings name idoc.club', stale.length === 0 ? 'ok' : 'todo',
    stale.length === 0 ? 'BASE_URL, GOOGLE_OAUTH_REDIRECT_URI and QSTASH_CALLBACK_BASE_URL all use the live domain.'
      : `Still not on idoc.club: ${stale.map(([name, , host]) => `${name} (${host ?? 'not set'})`).join(', ')}. Change them at the switch (docs/30 step B3).`);

  // After an import has run, the temporary switch and key should be gone (docs/30 step B11), so absence is the finished state.
  const imported = legacyImports > 0;
  add('import-switch', 'Legacy import switched on', input.legacyImportEnabled ? (imported ? 'todo' : 'ok') : imported ? 'ok' : 'todo',
    imported ? (input.legacyImportEnabled ? 'The import has run; remove LEGACY_IMPORT_ENABLED and redeploy (docs/30 step B11).' : 'The import has run and the switch is off.')
      : input.legacyImportEnabled ? 'LEGACY_IMPORT_ENABLED is on.' : 'LEGACY_IMPORT_ENABLED is off. Turn it on for the import (docs/30 step B3).');
  add('import-key', 'Read-only Stripe key for the import', input.legacyKeyPresent ? (imported ? 'todo' : 'ok') : imported ? 'ok' : 'todo',
    imported ? (input.legacyKeyPresent ? 'The import has run; remove LEGACY_STRIPE_SECRET_KEY, redeploy and revoke the key in Stripe.' : 'The import has run and the key is removed from Vercel; confirm it is revoked in Stripe.')
      : input.legacyKeyPresent ? 'LEGACY_STRIPE_SECRET_KEY is set. Remove it and revoke the key after the import.' : 'LEGACY_STRIPE_SECRET_KEY is not set. The import needs it for the live Stripe comparison.');

  add('hold', 'Member communications and billing hold', input.holdOn ? 'ok' : 'warn',
    input.holdOn ? 'The hold is on. Keep it on through the import; release it only at step B8.' : 'The hold is OFF: emails and live billing are active. Replay needs it off, the import needs it on.');
  add('safeguard', 'Live Stripe actions safeguard', input.reconciliationLiveEnabled ? 'warn' : 'ok',
    input.reconciliationLiveEnabled ? 'RECONCILIATION_LIVE_STRIPE_ACTIONS is enabled: a scan can now cancel subscriptions and delete customers in Stripe. Only keep it on once the import is verified.'
      : 'Off (default): reconciliation only simulates Stripe changes.');
  return checks;
}

// ---- Final verification: run after the import, replay and first scan (docs/30 step B12). Reports the end state of everything the switchover touched. ----

export type FinalInputs = {
  deadLetteredOther: number;
  heldEventsPending: number;
  hold: SwitchoverInputs['holdOn'];
  importRun: { at: string; imported: number; payments: number; subscriptions: number } | null;
  keyMode: SwitchoverInputs['stripeKeyMode'];
  legacyImportEnabled: boolean;
  legacyKeyPresent: boolean;
  liveActionsEnabled: boolean;
  members: { payments: number; profiles: number; subscriptionsByStatus: Record<string, number>; users: number };
  openFindings: Record<string, number>;
  outboxPending: number;
  replayRun: { at: string; failed: number; processed: number } | null;
  scanAt: string | null;
  webhook: SwitchoverInputs['webhook']['state'];
  webhookEventsLast24h: number;
};

export function evaluateFinal(input: FinalInputs): SwitchoverCheck[] {
  const checks: SwitchoverCheck[] = [];
  const add = (id: string, label: string, status: SwitchoverCheck['status'], detail: string) => checks.push({ detail, id, label, status });
  const statusText = Object.entries(input.members.subscriptionsByStatus).map(([name, n]) => `${n} ${name}`).join(', ') || 'none';

  add('final-import', 'Legacy import ran', input.importRun ? 'ok' : 'todo',
    input.importRun ? `Imported ${input.importRun.imported} members, ${input.importRun.payments} payments and ${input.importRun.subscriptions} subscriptions on ${input.importRun.at.slice(0, 16).replace('T', ' ')} UTC.` : 'No legacy import is recorded in this environment.');
  add('final-members', 'Members now in the database', input.members.users > 0 ? 'ok' : 'todo',
    `${input.members.users} users, ${input.members.profiles} profiles, ${input.members.payments} payments; subscriptions: ${statusText}. Compare these with the import dry run.`);
  add('final-import-off', 'Import switched off and key removed', !input.legacyImportEnabled && !input.legacyKeyPresent ? 'ok' : 'todo',
    !input.legacyImportEnabled && !input.legacyKeyPresent ? 'LEGACY_IMPORT_ENABLED and LEGACY_STRIPE_SECRET_KEY are gone. Also confirm the restricted key is revoked in Stripe (this page cannot see that).'
      : 'LEGACY_IMPORT_ENABLED or LEGACY_STRIPE_SECRET_KEY is still set. Remove them, redeploy and revoke the key in Stripe.');
  add('final-hold', 'Launch hold released', input.hold ? 'todo' : 'ok', input.hold ? 'The hold is still on, so no email or live billing is active yet (docs/30 step B8).' : 'The hold is off: member emails and live billing are active.');
  add('final-stripe', 'Stripe live and receiving', input.keyMode === 'live' && input.webhook === 'ok' ? (input.webhookEventsLast24h > 0 || input.hold ? 'ok' : 'warn') : 'todo',
    input.keyMode !== 'live' ? 'The Stripe key is not a live-mode key.' : input.webhook !== 'ok' ? 'The webhook endpoint is not enabled for this site with every handled event type.'
      : input.hold ? 'Live key and webhook endpoint are in place. Events received while the hold is on are recorded, not applied.'
        : input.webhookEventsLast24h > 0 ? `${input.webhookEventsLast24h} Stripe events received in the last 24 hours.` : 'No Stripe events were received in the last 24 hours. That may be normal on a quiet day; if a payment just happened, check the endpoint\'s delivery log in Stripe.');
  add('final-held-events', 'Events consumed by the hold', input.heldEventsPending === 0 ? 'ok' : 'todo',
    input.heldEventsPending === 0 ? 'No event is waiting to be replayed.' : `${input.heldEventsPending} events were recorded but not applied because the hold was on. Replay them (docs/30 step B9).`);
  add('final-replay', 'Missed events replayed', input.replayRun ? (input.replayRun.failed > 0 ? 'warn' : 'ok') : 'todo',
    input.replayRun ? `Replay on ${input.replayRun.at.slice(0, 16).replace('T', ' ')} UTC applied ${input.replayRun.processed} events${input.replayRun.failed > 0 ? `; ${input.replayRun.failed} FAILED. Preview again to retry them` : ''}.` : 'No replay is recorded. Run a preview on the replay page; if it shows nothing to replay, this is fine.');
  const open = Object.entries(input.openFindings).filter(([, n]) => n > 0);
  add('final-scan', 'Reconciliation scan run', input.scanAt ? 'ok' : 'todo', input.scanAt ? `Last scan ${input.scanAt.slice(0, 16).replace('T', ' ')} UTC.` : 'No scan has run. Run one on the reconciliation page.');
  add('final-findings', 'Open reconciliation findings', open.length === 0 ? 'ok' : 'warn',
    open.length === 0 ? 'No open findings.' : `Open: ${open.map(([kind, n]) => `${n} ${kind.replace(/_/g, ' ')}`).join(', ')}. Review each on the reconciliation page.`);
  add('final-safeguard', 'Live Stripe actions switch', input.liveActionsEnabled ? 'warn' : 'ok',
    input.liveActionsEnabled ? 'ON: scans can cancel subscriptions and delete customers in Stripe. Leave it on only after the findings above are reviewed.' : 'Off: scans only simulate Stripe changes. Turn it on (RECONCILIATION_LIVE_STRIPE_ACTIONS=enabled) only when you want orphaned subscriptions and unlinked customers cleaned up in Stripe.');
  add('final-queues', 'Email and job queues', input.deadLetteredOther > 0 ? 'warn' : 'ok',
    `${input.outboxPending} jobs pending${input.hold ? ' (held while the hold is on)' : ''}; ${input.deadLetteredOther} failed permanently for a reason other than the hold.`);
  return checks;
}
