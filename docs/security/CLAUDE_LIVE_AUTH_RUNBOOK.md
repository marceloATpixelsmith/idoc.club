# GitHub Actions — Live Authentication & Security Runbook

## Authority

Read `tests/auth/auth-test-matrix.json` first. It is the single source of truth for live test IDs, steps, PASS/FAIL criteria, cleanup rules, CI mappings, and applicability. `docs/security/AUTH_TEST_CATALOG.md` is generated from the same source.

Do not invent alternate pass criteria. Do not silently omit a live-enabled case.

## Target boundary

- Test only the explicitly provided staged/live hostname.
- Never substitute localhost or a Vercel preview.
- Use disposable accounts and the existing Pixelsmith E2E Email connector for flows requiring real mail. Do not claim GitHub Actions can create/read mailboxes until its MXroute integration is implemented.
- Do not perform denial-of-service, high-volume load, destructive actions against non-test data, social engineering, third-party attacks, or testing outside the authorized hostname.
- Request replay/tampering is allowed only against disposable test identities and at bounded rates.

## Known staging environment facts

- Staging hostname: `staging.idoc.club` (a dedicated Vercel Preview deployment on the `staging`
  branch, built specifically for this audit -- `redesign.idoc.club` is production; never target it).
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
- Staging and production use the same Render PostgreSQL database instance but have separate schemas: `idoc_staging` and `idoc_production`. Their application roles are isolated: `idoc_staging_app` can access the staging schema, and `idoc_production_app` can access the production schema. Staging uses `DB_SCHEMA=idoc_staging`; never point live-auth provisioning or cleanup at a production connection.
- The live-auth TypeScript and SQL provisioning/cleanup tools require the staging connection role `idoc_staging_app`, database `ayni_space`, and current schema `idoc_staging`; the tools fail closed if those checks do not match. Every table reference is explicitly qualified with `idoc_staging`. A test run changes rows only in the staging schema; it does not query or mutate production-schema member rows. Test identities and staging audit records still need the documented cleanup.
- `tests/staging-database-url.test.ts` verifies the operator-tooling allow/deny boundary for the staging role, database, and disposable mailbox domain. These checks do not change any live-auth case's behavior or pass criteria.
- For manual verification, the existing read-only Render MCP connector can query staging tables in `idoc_staging`; it cannot run provisioning or cleanup writes.
- Google OAuth real consent/account-linking is manual-only (`LIVE-AUTH-004`) and excluded from unattended GitHub runs. `LIVE-AUTH-022` remains automated using password/email authentication for safe return-path behavior. The GitHub result must identify the Google steps as `blocked` / manual-required, never pass.\n- Known real Super Admin id on staging for `--granted-by` / `GRANTED_BY_USER_ID`: user id `7`
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

For every case with `requiresEmail=true`:
- Reuse the run's existing disposable mailbox/account when it can safely support the next step; create another mailbox or account only when a clean identity or distinct email address is required.
- Until the GitHub Actions MXroute integration is implemented, use the existing Pixelsmith E2E Email connector for manual live runs.
- Make the staged application itself send the transactional email; poll/read the mailbox and use the real link/code in the browser flow.
- Never use `send_e2e_test_message` as a substitute for the application's own outbound email.
- Delete each mailbox once after all dependent flows that use it have passed; preserve it temporarily when failure evidence depends on it.

## Privileged (administrator/super_admin) test identities

Cases with `live.requiresAdmin=true` need a disposable privileged identity because IDOC has no self-service role elevation. The canonical TypeScript/SQL scripts remain available for provisioning and cleanup, and enforce the staging-only connection boundary.

Until the GitHub Actions database provisioning and cleanup steps are implemented and verified, continue using the documented operator procedure for role grants and cleanup. Do not represent any privileged case as fully automated before the workflow provisions its identity through `STAGING_POSTGRES_URL` and confirms cleanup. For a manual run, follow the current staging-only instructions and preserve the generated cleanup SQL handoff.

The intended GitHub workflow must reuse one privileged identity across all cases that its granted role authorizes, and must attempt cleanup once for every unique test identity. It must never use a production URL or schema-owner credentials.

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
