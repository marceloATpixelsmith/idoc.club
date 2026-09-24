# Claude Code Cloud — Live Authentication & Security Runbook

## Authority

Read `tests/auth/auth-test-matrix.json` first. It is the single source of truth for live test IDs, steps, PASS/FAIL criteria, cleanup rules, CI mappings, and applicability. `docs/security/AUTH_TEST_CATALOG.md` is generated from the same source.

Do not invent alternate pass criteria. Do not silently omit a live-enabled case.

## Target boundary

- Test only the explicitly provided staged/live hostname.
- Never substitute localhost or a Vercel preview.
- Use disposable accounts and the Pixelsmith E2E Email connector for flows requiring real mail.
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
- **The staging and production deployments deliberately share the same Postgres database** (one
  `POSTGRES_URL` value, `target: ["production", "preview"]`, no `gitBranch` override) -- staging
  is deliberately near-identical to production under `docs/07` §15's policy, not isolated from
  it; the database is one of the values staging shares verbatim (Stripe and Brevo credentials
  and the URL-family values are the named exceptions that differ instead). Sharing the database
  specifically also avoids paying for a second Render Postgres instance. See `docs/07` "Branch,
  environment, and deployment workflow" for the full policy. This is a permanent,
  operator-confirmed decision, not a temporary gap or an oversight of this runbook. Practical
  consequences for this audit:
  - Every disposable test account, adversarial request, and piece of test data created during a
    live-auth run lands in the real production database alongside genuine member data.
  - The read-only `query_render_postgres` connector below is querying the **same** database
    production reads/writes -- a query result may include real member rows, not just test rows.
  - End-of-run cleanup (`scripts/e2e-delete-test-account.sql`) is not optional cosmetic tidying
    here -- it is removing real rows from the production database. Treat every disposable
    `@pixelsmith.space` account created during a run as required cleanup, not best-effort.
  - Prefer the least invasive adversarial techniques that still validate the control (e.g. avoid
    bulk/high-count operations even where the case would otherwise tolerate them), since there is
    no environment isolation backstopping a mistake.
- Staging's Postgres is reachable **read-only** from Claude Code's sandboxed session via the Render
  MCP connector's `query_render_postgres` tool (`postgresId` `dpg-d3c3gd2li9vc73d8n3o0-a`,
  `workspaceId` `tea-d3c3eq7diees7392talg`; the app schema inside it is `idoc`). Useful for
  verification queries (confirming target/revision, checking a grant landed, session-policy
  inspection for LIVE-AUTH-033) but cannot run any INSERT/UPDATE/DELETE -- see "Privileged
  (administrator/super_admin) test identities" below for why, and how role grants and cleanup are
  actually performed.
- **Operator's standing Google test identity for LIVE-AUTH-004/022 (Google OAuth):**
  `pixelsmithtest@gmail.com`. Claude cannot complete a real Google consent screen itself (Google
  blocks automated/headless logins), so the case's happy-path and account-linking steps are done by
  the human operator using this account, on request from Claude at the right point in the run; Claude
  independently verifies the resulting database state (identity row, session, audit_log entry) via
  the read-only connector above rather than trusting the operator's report alone. The
  adversarial/tamper/replay/cancel-deny portions of the same case do not need this account and are
  run by Claude directly. Do not ask the operator which account to use -- use this one unless they
  say otherwise.
- Known real Super Admin id on staging for `--granted-by` / `GRANTED_BY_USER_ID`: user id `7`
  (`zangfuqi@gmail.com`). Confirm it still holds an active `super_admin` grant before relying on it
  -- query `idoc.application_roles` via the read-only connector above.

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
- create a mailbox with the connected Pixelsmith E2E Email tools;
- make the staged application itself send the transactional email;
- poll/read the mailbox and use the real link/code in the browser flow;
- never use `send_e2e_test_message` as a substitute for the application's own outbound email;
- delete the mailbox only after the flow passes; preserve it temporarily when failure evidence depends on it.

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
   itself and its profile are **not** physically deleted -- `idoc.audit_log`/`idoc.profile_change_history`
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
