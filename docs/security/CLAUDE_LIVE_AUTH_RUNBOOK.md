# GitHub Actions — Live Authentication & Security Runbook

## Authority

Read `tests/auth/auth-test-matrix.json` first. It is the single source of truth for live test IDs, steps, PASS/FAIL criteria, cleanup rules, CI mappings, and applicability. `docs/security/AUTH_TEST_CATALOG.md` is generated from the same source.

Do not invent alternate pass criteria. Do not silently omit a live-enabled case.

## Target boundary

- Test only the explicitly provided staged/live hostname.
- Never substitute localhost or a Vercel preview.
- Use the Pixelsmith E2E Email service for staging runs. GitHub Actions creates one disposable mailbox per run, reuses it through the sequential auth journey, and deletes it once during cleanup. Do not print mailbox credentials or message contents in logs.
- Do not perform denial-of-service, high-volume load, destructive actions against non-test data, social engineering, third-party attacks, or testing outside the authorized hostname.
- Request replay/tampering is allowed only against disposable test identities and at bounded rates.

## Known staging environment facts

- Staging hostname: `staging.idoc.club` (a dedicated Vercel Preview deployment on the `staging`
  branch, built specifically for this audit -- `redesign.idoc.club` is production; never target it).
  Use the existing shared Vercel variables `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and
  `TURNSTILE_SECRET_KEY`; they must resolve to Cloudflare's official always-pass testing pair for
  staging. Do not create project-specific duplicates. Never expose the testing secret to production.
  `staging.idoc.club` uses Cloudflare Turnstile always-pass testing keys scoped to the `staging`
  branch, so automated signup/reset flows can complete Turnstile without weakening real bot
  protection on production. This requires `lib/auth/turnstile.ts`'s narrow, explicit exception
  (docs/21 AUTH-TURNSTILE-006) for Cloudflare's own fixed testing-secret response shape --
  the client widget alone auto-passing is not sufficient, since the app's server-side
  `verifyTurnstile` independently binds every token to the real hostname/action by design and
  Cloudflare's testing-key response can never satisfy that binding on its own. Do not remove that
  exception (or revert staging to a real Turnstile widget) without re-checking this file: a prior
  version of this setup used a real per-hostname widget, and every Turnstile-gated live-auth case
  needed a human to solve it manually, one flow at a time.
- **Staging and production share one Render PostgreSQL database instance but use separate schemas and application roles.** Staging writes belong only in schema `idoc_staging` through role `idoc_staging_app`; production uses schema `idoc_production` through role `idoc_production_app`. The live-auth provisioning and cleanup scripts must qualify every table as `idoc_staging.*`, verify the active role/database/schema before writes, and reject production credentials. Keep `STAGING_POSTGRES_URL` scoped to the staging application role. Never connect with a schema-owner or production role. The shared database instance does not mean the schemas are shared: test rows and cleanup must remain inside `idoc_staging`.
- The read-only `query_render_postgres` connector can verify staging data in `idoc_staging`; it cannot run provisioning or cleanup writes.
- Google OAuth real consent/account-linking is manual-only (`LIVE-AUTH-004`) and excluded from unattended GitHub runs. `LIVE-AUTH-022` remains automated using password/email authentication for safe return-path behavior. The GitHub result must identify the Google steps as `blocked` / manual-required, never pass.
- Known real Super Admin id on staging for `--granted-by` / `GRANTED_BY_USER_ID`: user id `7`
  (`zangfuqi@gmail.com`). Confirm it still holds an active `super_admin` grant before relying on it
  -- query `idoc_staging.application_roles` via the read-only connector above.

## Execution order

1. Run `LIVE-AUTH-030` first to establish deployed target/revision evidence.
2. Execute every case whose `live.enabled` is true. Use numeric order unless a dependency requires otherwise.
3. For each case classify exactly one of: `pass`, `fail`, `blocked`.
4. When a failure is found, continue unrelated safe cases and preserve only the minimum disposable state needed to reproduce it.
5. Run `LIVE-AUTH-028` only after normal functional/security cases.
6. Run `LIVE-AUTH-031` last for cleanup and retained-failure-state accounting.
7. Report `LIVE-AUTH-032` as `not-applicable` unless the product has gained a real invitation flow.

## Real email

For every automated case with `requiresEmail=true`:
- The `Live authentication staging suite` creates one disposable mailbox through `scripts/live-auth-mailbox.mjs`, reads only the OTP needed by the browser test, and reuses that mailbox for all sequential steps.
- The staged application itself sends the transactional message. The runner never uses the service's `send` endpoint as a substitute.
- Keep `DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING=true`. The application permits only the explicitly opted-in authentication OTP to the run's `@pixelsmith.space` mailbox when `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF=staging`, and `BASE_URL=https://staging.idoc.club`. All other member and operational email remains held; billing remains held.
- Mailbox cleanup runs once after account cleanup, including when the browser test fails.
- The first automated journey covers LIVE-AUTH-001, 002, 003, 005, 006, 022, and 038 using one account and one mailbox. Every other live case is reported as blocked until its own safe browser journey is implemented. LIVE-AUTH-004 remains manual-only and is always reported as blocked/manual-required.

## GitHub Actions live staging configuration

The workflow is `.github/workflows/live-auth-staging.yml`. A push to the `staging` branch (normally a merged PR) starts the run; it never runs on pull requests. Before entering the `staging-live-e2e` environment or using its secrets, a separate job waits for a successful Vercel status on that exact commit, verifies the status points to the IDOC Vercel project, and confirms `staging` has not advanced. A failed deployment, stale commit, or missing deployment status stops the run before mailbox or account creation. The workflow is currently defined on `staging`, not the default `main` branch, so it does not appear in the Actions list when viewing `main`.

Configure these GitHub Actions secrets:
- `STAGING_POSTGRES_URL`: Render URL for database `ayni_space` and role `idoc_staging_app`. The workflow validates that role and database, then adds `search_path=idoc_staging` for its connection; the Vercel `POSTGRES_URL` value can be reused if it passes those checks.
- `E2E_SERVICE_TOKEN`: bearer token for the Pixelsmith E2E Email service.
- `LIVE_AUTH_TEST_PASSWORD`: disposable account password used only for the live signup/login journey.

Optional repository variable:
- `E2E_SERVICE_URL`: service base URL; defaults to the existing Pixelsmith E2E service URL.

The workflow hard-fails before browser activity unless the database URL is restricted to the staging role/database/schema. All database provisioning and cleanup SQL is explicitly qualified with `idoc_staging`. Never configure the production role, schema, or URL in these secrets.


## Privileged (administrator/super_admin) test identities

IDOC has no self-service role elevation (docs/07-administrator-and-operations-runbook.md:
Organization Settings and role grants are Super-Admin-only, provisioned directly, not through an
invitation flow). Cases with `live.requiresAdmin=true` (009-013, 017, 026, 033) therefore need a
disposable privileged identity provisioned out of band before they can run live.

**Claude Code's sandboxed session cannot write to the staging database itself.** Raw Postgres TCP
egress is blocked at the network level, and the one read path that does work (Render's own
`query_render_postgres` MCP tool) is explicitly read-only by design -- confirmed by testing both
directly. There is no plugin, connector, or workaround that grants write access from inside the
sandbox; do not keep re-attempting one. Both `scripts/e2e-grant-privileged-role.ts` and
`scripts/e2e-delete-test-account.ts` remain the canonical, tested implementations of this logic (run
them yourself from an environment with real Postgres write access, e.g. locally or from CI, if you
have one) -- but when Claude itself runs the audit, role provisioning and cleanup are handed off as
ready-to-run SQL instead:

1. Complete a real signup through the live app for a disposable `@pixelsmith.space` test address
   (LIVE-AUTH-001), so account state, verification, and TOTP enrollment stay genuinely live-tested.
2. Fill in `scripts/e2e-grant-privileged-role.sql`'s `{{TARGET_EMAIL}}`, `{{TARGET_ROLE}}`, and
   `{{GRANTED_BY_USER_ID}}` placeholders with real values (see "Known staging environment facts"
   above for the granter id) and hand the resulting SQL to the operator to run against staging with
   an actual write-capable Postgres client (`psql "$STAGING_POSTGRES_URL" -f <file>`, or pasted into
   Render's dashboard SQL console). Wait for confirmation it ran before continuing -- do not guess
   that it succeeded. It records an `application_roles` row and a matching `audit_log` entry tagged
   as automated test-tooling provisioning, so LIVE-AUTH-026's audit-evidence check still sees a
   coherent, attributable trail, and increments `session_version` so the grant only takes effect
   through a genuine fresh login (mirrors `lib/membership/role-grants.ts` exactly).
3. Run the applicable LIVE-AUTH cases.
4. At the end of the run (whether it passed or not), fill in `scripts/e2e-delete-test-account.sql`'s
   `{{TARGET_EMAILS}}` placeholder with every disposable `@pixelsmith.space` email created during
   this run (not just the privileged one) and deliver the resulting file to the operator alongside
   the results JSON. It deletes every genuinely deletable row each account owns -- its own sessions,
   MFA factors/codes, role grants, and membership rows -- and per account, not as one all-or-nothing
   batch: if one account is ever referenced on a row it does not own (verified someone else's
   professional role, authored real content, recorded a real member's payment), that account alone
   is skipped with a warning and every other account in the list is still cleaned up. The account row
   itself and its profile are **not** physically deleted -- `idoc_staging.audit_log`/`idoc_staging.profile_change_history`
   are immutable by design (a database trigger unconditionally rejects updating or deleting them),
   and the foreign keys referencing them block deleting their parent rows too, once any audited
   action was ever recorded for the account. Instead the account is neutralized exactly like the
   app's own self-service `deleteOwnAccount()` (`lib/membership/data-access.ts`): `account_state`
   set to `deleted` and the login email permanently mangled, so it can never authenticate again and
   the address becomes reusable. The immutable rows this leaves behind never contain secrets by
   design (see Evidence rules below), so this is not a leak -- it is the same tradeoff every real
   account deletion in this app already makes.

Both the `.ts` and `.sql` forms refuse any email outside `@pixelsmith.space` and are otherwise kept
in exact lockstep -- change one, change the other. Never point either at a real member's database or
run either against a non-disposable account.

This tooling is operator-only test infrastructure: it changes no product-facing auth behavior, adds
no endpoint or user-reachable flow, and alters no LIVE-AUTH case's pass/fail criteria -- it only
provisions and tears down the disposable privileged identity the already-canonical `requiresAdmin`
cases above call for. No new canonical test case is warranted for it.

## Evidence rules

For failures record the LIVE-AUTH ID, exact target hostname, role/account state, reproduction steps, expected result, actual result, relevant HTTP status/request path, screenshot/trace/log reference where useful, and retained disposable state.

Never record passwords, TOTP secrets, recovery codes, session cookies, reset tokens, E2E mailbox passwords, API tokens, OAuth secrets, or other credentials.

## Required output

Create `test-results/auth/auth-live-results.json` conforming to `docs/security/auth-live-results.schema.json`.

Also provide a concise human report grouped into PASS, FAIL, BLOCKED, and NOT APPLICABLE, using the `LIVE-AUTH-###` ID in every entry.

If any disposable `@pixelsmith.space` account was created during the run, also deliver the filled-in
cleanup SQL (see "Privileged (administrator/super_admin) test identities" above -- the same
hand-off applies whether or not any case needed a privileged identity) as a file, and say so plainly
in the report: cleanup is not done until the operator actually runs it. Never claim disposable state
was removed unless you have direct confirmation the SQL was executed.

If `test-results/auth/auth-ci-results.json` is available for the same revision, run:

```bash
node scripts/merge-auth-test-results.mjs
```

to create `test-results/auth/auth-combined-results.md`.

## Retest rule

After a defect is fixed, rerun:
1. the exact failed LIVE-AUTH case;
2. its mapped CI tests from `ci.tests`;
3. adjacent cases sharing the same canonical controls or auth state;
4. the full live suite before release for critical/high auth changes.

If a discovered defect is not represented by an existing case, add a new case to `tests/auth/auth-test-matrix.json` before considering the fix complete, then add deterministic CI regression coverage where technically possible.
