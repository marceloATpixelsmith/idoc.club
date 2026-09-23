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
disposable privileged identity provisioned out of band before they can run live:

1. Complete a real signup through the live app for a disposable `@pixelsmith.space` test address
   (LIVE-AUTH-001), so account state, verification, and TOTP enrollment stay genuinely live-tested.
2. Grant the role against staging: `node --conditions=react-server --import tsx
   scripts/e2e-grant-privileged-role.ts --email=<addr> --role=administrator|super_admin
   --granted-by=<real Super Admin user id> --confirm-staging`, with `STAGING_POSTGRES_URL` set to
   staging's own database (never `POSTGRES_URL`/production). Records an `application_roles` row and
   a matching `audit_log` entry tagged as automated test-tooling provisioning, so LIVE-AUTH-026's
   audit-evidence check still sees a coherent, attributable trail.
3. Run the applicable LIVE-AUTH cases.
4. Tear the identity down: `node --conditions=react-server --import tsx
   scripts/e2e-delete-test-account.ts --email=<addr> --confirm-staging` (add `--dry-run` first to
   preview). This deletes only rows the test account owns -- its own sessions, MFA factors/codes,
   role grants, profile/membership rows, and its own audit_log entries. If the account is ever
   referenced on a row it does not own (verified someone else's professional role, authored real
   content, recorded a real member's payment), the script aborts with no changes instead of touching
   that row -- resolve that manually before re-running.

Both scripts refuse to run without `--confirm-staging` and refuse any email outside
`@pixelsmith.space`; see `lib/db/staging-database-url.ts`. Never point `STAGING_POSTGRES_URL` at a
real member's database or run this against a non-disposable account.

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
