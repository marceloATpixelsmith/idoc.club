import type { FinalInputs, SwitchoverInputs } from './switchover-checks-core.ts';

// The guided walkthrough for the production switchover (docs/30). Pure: the server gathers `GuideInputs`, this module decides what each step says and whether the site can
// already see it as done. Steps the site cannot see (Vercel, Stripe, Brevo and GoDaddy dashboards) are manual and ticked by the operator in their own browser.

export type GuideEnvChange = { action: string; name: string; scope: string };
export type GuideStep = {
  actions: string[];
  /** `true` when the site can tell by itself whether the step is done; `autoDone` is then that answer. */
  auto: boolean;
  autoDone: boolean;
  env: GuideEnvChange[];
  id: string;
  link?: { href: string; label: string };
  phase: 'A' | 'B';
  title: string;
  where: string;
};
export type GuideInputs = { final: FinalInputs; host: string | null; inputs: SwitchoverInputs };

const LIVE_HOSTS = ['idoc.club', 'www.idoc.club'];
const onLiveDomain = (host: string | null) => host !== null && LIVE_HOSTS.includes(host);

/** A replay audit only counts when it was written after the current import and no event failed; an earlier rehearsal does not recover payments made during the cutover. */
const replayedAfterImport = (final: FinalInputs) => final.replayRun !== null && final.replayRun.failed === 0 && final.importRun !== null && final.replayRun.at > final.importRun.at;

/** The reconciliation scan only counts when it ran after the successful replay, because the replay changes membership and payment state. */
const scannedAfterReplay = (final: FinalInputs) => replayedAfterImport(final) && final.scanAt !== null && final.replayRun !== null && final.scanAt > final.replayRun.at;

export function buildGuide({ final, host, inputs }: GuideInputs): GuideStep[] {
  const imported = inputs.counts.legacyImports > 0;
  const domainsLive = [inputs.baseUrlHost, inputs.googleRedirectHost, inputs.qstashHost].every(onLiveDomain);
  const step = (s: Omit<GuideStep, 'autoDone'> & { autoDone?: boolean }): GuideStep => ({ autoDone: false, ...s });
  const manual = (s: Omit<GuideStep, 'auto' | 'autoDone' | 'env'> & { env?: GuideEnvChange[] }): GuideStep => step({ auto: false, env: [], ...s });

  return [
    // ---- A. Before the day --------------------------------------------------------------------------------------------------------------------------------------
    step({
      actions: ['Approve the Auto-migrate Production Schema run in GitHub if one is waiting. Nothing else to do when this shows done.'],
      auto: true, autoDone: inputs.ledgerNewest !== null && inputs.ledgerNewest === inputs.journalNewest && inputs.stagingNewest === inputs.ledgerNewest,
      env: [], id: 'A1', phase: 'A', title: 'Production code and database migrations are current', where: 'GitHub Actions',
    }),
    step({
      actions: ['Delete the test users, profiles and subscriptions on production so the import starts from an empty member set. Administrators stay.'],
      auto: true, autoDone: imported || inputs.counts.users + inputs.counts.profiles + inputs.counts.subscriptions === 0,
      env: [], id: 'A2', phase: 'A', title: 'Test data is cleared from production', where: 'Production admin / database',
    }),
    manual({
      actions: [
        'Each of the three Stripe variables is one entry that covers Production and Preview, so staging and production share one value. Split them before Thursday.',
        'Edit each existing entry: untick Production (it stays for Preview and should be limited to the `staging` branch with the TEST-mode value).',
        'Immediately add the same three names again with only Production ticked, holding the value production has today. Do not deploy between the two actions.',
        'On Thursday (step B3) the Production entries get the live values. Staging never changes.',
      ],
      env: [
        { action: 'split: Preview/staging branch keeps test value', name: 'STRIPE_SECRET_KEY', scope: 'Preview (staging branch)' },
        { action: 'split: Preview/staging branch keeps test value', name: 'STRIPE_WEBHOOK_SECRET', scope: 'Preview (staging branch)' },
        { action: 'split: Preview/staging branch keeps test value', name: 'STRIPE_MEMBERSHIP_PRODUCT_ID', scope: 'Preview (staging branch)' },
        { action: 'new separate entry', name: 'the same three variables', scope: 'Production only' },
      ],
      id: 'A3', phase: 'A', title: 'Split the Stripe variables so production and staging have their own', where: 'Vercel project settings',
    }),
    manual({
      actions: [
        'Generate a value: run `openssl rand -hex 32` (letters and numbers only, at least 32 characters).',
        'Add it in Vercel as a Production-only variable. Keep a copy: the same value goes into the Brevo webhook URL in step B5.',
        'The site only sees the variable after the next production deployment (step B3 does one), so tick this yourself; the status section below confirms it afterwards.',
      ],
      env: [{ action: 'add: random value, 32+ characters', name: 'BREVO_WEBHOOK_KEY', scope: 'Production only' }],
      id: 'A4', phase: 'A', title: 'Create the Brevo webhook key', where: 'Vercel project settings',
    }),
    manual({
      actions: ['`LEGACY_STRIPE_SECRET_KEY` has an entry that applies to every Preview branch. Delete that one and keep the entry limited to the `staging` branch.'],
      env: [{ action: 'delete the all-Preview entry', name: 'LEGACY_STRIPE_SECRET_KEY', scope: 'Preview (all branches)' }],
      id: 'A5', phase: 'A', title: 'Remove the broad Preview copy of the legacy Stripe key', where: 'Vercel project settings',
    }),
    manual({
      actions: [
        'Seminars and News/Blog move from staging to production with the Data Promotion tool, up to ten records at a time, on the STAGING site.',
        'One-time setup first: create the database role `idoc_data_promoter` (SQL in docs/07), add `DATA_PROMOTION_DATABASE_URL` and `DATA_PROMOTION_PLAN_SECRET` for the staging branch only, redeploy staging.',
        'Then preview each batch, resolve conflicts with the content production already has, and execute with your authenticator code.',
      ],
      env: [
        { action: 'add: connection URL of the idoc_data_promoter role', name: 'DATA_PROMOTION_DATABASE_URL', scope: 'Preview (staging branch only)' },
        { action: 'add: random secret, 32+ bytes', name: 'DATA_PROMOTION_PLAN_SECRET', scope: 'Preview (staging branch only)' },
      ],
      id: 'A6', link: { href: 'https://staging.idoc.club/admin/operations/data-promotion', label: 'Open Data Promotion on staging' },
      phase: 'A', title: 'Promote seminars and news/blog from staging to production', where: 'Staging site + Vercel + Render',
    }),
    manual({
      actions: ['`idoc.club` and `www.idoc.club` must be listed on the production Vercel project (DNS still points at WordPress). They were added on 15 Oct; tick when you have seen them listed.'],
      id: 'A7', phase: 'A', title: 'Both domains are added to the production Vercel project', where: 'Vercel project → Domains',
    }),
    manual({
      actions: ['Lower the TTL of the `idoc.club` A records and the `www` CNAME to the minimum GoDaddy allows (600 seconds today).'],
      id: 'A8', phase: 'A', title: 'DNS TTL is as low as it goes', where: 'GoDaddy DNS',
    }),
    manual({
      actions: [
        'Create the live-mode webhook endpoint for `https://idoc.club/api/stripe/webhook` with every event type the site handles, and copy its signing secret for step B3.',
        'Leave it DISABLED. It is enabled in step B8, after the import.',
      ],
      id: 'A9', phase: 'A', title: 'Create the live Stripe webhook endpoint (disabled)', where: 'Stripe dashboard (live mode)',
    }),
    manual({
      actions: ['Check that the Google sign-in client lists the `idoc.club` callback and that Cloudflare Turnstile covers `idoc.club` (a domain covers its subdomains).'],
      id: 'A10', phase: 'A', title: 'Google sign-in and Turnstile accept idoc.club', where: 'Google Cloud console, Cloudflare',
    }),
    manual({
      actions: ['Run the legacy import dry run on staging with a fresh export to confirm nothing needs a decision.'],
      id: 'A11', link: { href: 'https://staging.idoc.club/admin/operations/legacy-import', label: 'Open the importer on staging' },
      phase: 'A', title: 'Dry-run the importer on staging', where: 'Staging site',
    }),

    // ---- B. Switchover day -----------------------------------------------------------------------------------------------------------------------------------------
    manual({
      actions: ['Turn on the maintenance message on the old WordPress site so nobody signs up or pays between the export and the DNS change.'],
      id: 'B1', phase: 'B', title: 'Freeze the WordPress site', where: 'WordPress',
    }),
    manual({
      actions: [
        'In phpMyAdmin export the WordPress users tables and the MemberPress tables as SQL.',
        'Write down the date and time you START the export, in your own local time. It is the start time for the event replay (step B10).',
      ],
      id: 'B2', phase: 'B', title: 'Export the WordPress and MemberPress tables', where: 'phpMyAdmin',
    }),
    step({
      actions: [
        'Change these Production variables, then redeploy production ONCE.',
        'The Stripe values must be the live ones, taken from the live dashboard and the live webhook endpoint you created in A9. The site rejects a test key once the base URL is `https://idoc.club`.',
        'Reload this page afterwards; it shows done when all of them are in effect.',
      ],
      auto: true, autoDone: domainsLive && inputs.stripeKeyMode === 'live' && (imported || (inputs.legacyImportEnabled && inputs.legacyKeyPresent)),
      env: [
        { action: '→ https://idoc.club', name: 'BASE_URL', scope: 'Production' },
        { action: '→ https://idoc.club/api/auth/google/callback', name: 'GOOGLE_OAUTH_REDIRECT_URI', scope: 'Production' },
        { action: '→ https://idoc.club', name: 'QSTASH_CALLBACK_BASE_URL', scope: 'Production' },
        { action: '→ live-mode secret key', name: 'STRIPE_SECRET_KEY', scope: 'Production' },
        { action: '→ signing secret of the live webhook endpoint', name: 'STRIPE_WEBHOOK_SECRET', scope: 'Production' },
        { action: '→ live membership product id', name: 'STRIPE_MEMBERSHIP_PRODUCT_ID', scope: 'Production' },
        { action: 'add: true', name: 'LEGACY_IMPORT_ENABLED', scope: 'Production' },
        { action: 'add: temporary restricted read-only live key', name: 'LEGACY_STRIPE_SECRET_KEY', scope: 'Production' },
      ],
      id: 'B3', phase: 'B', title: 'Switch production to the domain, live Stripe and the importer', where: 'Vercel project settings, then redeploy',
    }),
    step({
      actions: [
        'Point the apex A records and the `www` CNAME at the values Vercel shows for the project, then wait until Vercel shows both domains as valid.',
        'This step shows done when you load this page from `https://idoc.club`.',
      ],
      auto: true, autoDone: onLiveDomain(host) || imported, env: [], id: 'B4', phase: 'B', title: 'Switch DNS to Vercel', where: 'GoDaddy DNS',
    }),
    manual({
      actions: [
        'Now that `idoc.club` serves the site, add the Brevo webhook: Outbound webhook → Add webhook.',
        'URL: `https://idoc.club/api/brevo/webhook?key=` followed by your BREVO_WEBHOOK_KEY value. Authentication: none. Category: Transactional email. Events: Hard bounce, Soft bounce, Complaint only.',
      ],
      id: 'B5', phase: 'B', title: 'Add the Brevo webhook', where: 'Brevo → Plugins & Integrations → Webhooks',
    }),
    step({
      actions: ['Run the dry run with the new dumps, resolve or accept everything under "Needs a decision", then import (typed confirmation and backup confirmation required).'],
      auto: true, autoDone: imported, env: [], id: 'B6', link: { href: '/admin/operations/legacy-import', label: 'Open the importer' },
      phase: 'B', title: 'Run the legacy import', where: 'Legacy import page',
    }),
    manual({
      actions: ['Spot-check members, payments, subscriptions and the member count against the dry run.'],
      id: 'B7', link: { href: '/admin/members', label: 'Open Members' }, phase: 'B', title: 'Check the imported data in the admin', where: 'Admin',
    }),
    step({
      actions: [
        'Enable the live webhook endpoint you created in A9, only now that the import is in and checked. The launch hold stays ON.',
        'Payments for imported members arrive and are recorded immediately; anything sent before this point is picked up by the replay in B10.',
      ],
      auto: true, autoDone: inputs.webhook.state === 'ok' && (imported || onLiveDomain(inputs.baseUrlHost)), env: [], id: 'B8', phase: 'B', title: 'Enable the live Stripe webhook', where: 'Stripe dashboard (live mode)',
    }),
    step({
      actions: [
        'First work through items 4 and 5 of the pre-launch checklist in docs/27: inspect hold logs and outbox markers, suppress stale queued jobs, review webhook findings and canceled seminar registrations. Releasing the hold lets the workers resume anything still queued.',
        'Then set the production value to exactly `false` and redeploy. Staging stays `true`.',
      ],
      auto: true, autoDone: !inputs.holdOn, env: [{ action: '→ false (exactly)', name: 'DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING', scope: 'Production only' }],
      id: 'B9', phase: 'B', title: 'Release the launch hold', where: 'Vercel project settings, then redeploy',
    }),
    step({
      actions: ['Enter the export start time from B2, preview, check the counts, apply. A lower count than the number of payments since the export is expected (see B8).'],
      auto: true, autoDone: replayedAfterImport(final), env: [], id: 'B10', link: { href: '/admin/operations/event-replay', label: 'Open Replay Stripe events' },
      phase: 'B', title: 'Replay missed Stripe events', where: 'Replay page',
    }),
    step({
      actions: [
        'Run a scan and work through the findings.',
        'Stripe-changing actions stay simulated. Only after the import and replay are verified, optionally add `RECONCILIATION_LIVE_STRIPE_ACTIONS=enabled` (Production) and redeploy.',
      ],
      auto: true, autoDone: scannedAfterReplay(final),
      env: [{ action: 'optional, later: add enabled', name: 'RECONCILIATION_LIVE_STRIPE_ACTIONS', scope: 'Production' }],
      id: 'B11', link: { href: '/admin/reconciliation', label: 'Open reconciliation' }, phase: 'B', title: 'Run reconciliation and work the findings', where: 'Reconciliation page',
    }),
    step({
      actions: ['Delete both temporary variables, redeploy production, then revoke the restricted key in Stripe (this page cannot see that last part).'],
      auto: true, autoDone: imported && !inputs.legacyImportEnabled && !inputs.legacyKeyPresent,
      env: [
        { action: 'delete', name: 'LEGACY_IMPORT_ENABLED', scope: 'Production' },
        { action: 'delete, then revoke the key in Stripe', name: 'LEGACY_STRIPE_SECRET_KEY', scope: 'Production' },
      ],
      id: 'B12', phase: 'B', title: 'Remove the temporary import settings', where: 'Vercel project settings, then Stripe dashboard',
    }),
    step({
      actions: ['Reload and read the Final verification section below: every line should be Ready, or a Check you have consciously accepted.'],
      auto: true, autoDone: imported && final.hold === false && final.heldEventsPending === 0 && scannedAfterReplay(final) && !final.legacyImportEnabled && !final.legacyKeyPresent && final.keyMode === 'live',
      env: [], id: 'B13', phase: 'B', title: 'Final verification', where: 'This page',
    }),
  ];
}

/** The step to do next: the first one that is not done, where a manual step counts as done once the operator has ticked it. */
export function currentStepId(steps: GuideStep[], ticked: ReadonlySet<string>): string | null {
  return steps.find((step) => !(step.auto ? step.autoDone : ticked.has(step.id)))?.id ?? null;
}
