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
