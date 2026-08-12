**IDOC**

**Implementation Plan, Test Strategy & Cutover**

Phased execution plan designed to minimize member disruption and billing risk

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.1                                            |
| **Date**             | 11 August 2026                                 |

Working project document. Update this document when project decisions change.

# 1. Recommended implementation phases

| **Phase**                | **Primary output**                                                                                                                                                           | **Exit gate**                                       |
|--------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------|
| 1\. Discovery            | Legacy schema inventory, business-rule decisions, Stripe inventory.                                                                                                          | Unknown fields/rules documented.                    |
| 2\. Foundation           | Next.js starter deployed to non-production; Render PostgreSQL connection, dedicated idoc schema, isolated Drizzle migration ledger, and authentication baseline established. | Core environments working.                          |
| 3\. Membership model     | Profiles, memberships, professional roles, admin authorization.                                                                                                              | Member-isolation and administrator-role tests pass. |
| 4\. Billing integration  | Stripe Checkout/Portal/webhooks and local billing tables.                                                                                                                    | Test-mode billing lifecycle passes.                 |
| 5\. Admin workflows      | Search, manual payment, role/level changes, audit log.                                                                                                                       | Admin UAT passes.                                   |
| 6\. Migration tooling    | Repeatable exporter/transform/importer/reconciliation reports.                                                                                                               | Dry-run deterministic.                              |
| 7\. Staging rehearsal    | Full representative migration and exception resolution.                                                                                                                      | Counts/reconciliation signed off.                   |
| 8\. Production migration | Final export, delta handling, production import, Stripe link verification.                                                                                                   | Cutover checklist complete.                         |
| 9\. Post-launch          | Monitoring, exception cleanup, archival retention and approved legacy retirement.                                                                                              | Stabilization acceptance.                           |

# 2. Test matrix

## 2.1 Vercel Pro rollout checkpoints

| **Checkpoint** | **Scope** | **Verification gate** |
|---|---|---|
| Foundation deployment controls | Separate Vercel Production, Staging/UAT and Preview values; Sensitive Environment Variables; protected previews; Observability/Runtime Log access. | Preview uses isolated data and Stripe test mode; production secrets are not available there. |
| Public account-flow hardening | Endpoint-specific Firewall/WAF protections for authentication, recovery, verification/resend, email changes and contact forms. | Normal and abuse-path tests pass without account enumeration. |
| Billing/admin hardening | Extend coverage to Stripe webhooks, payment/renewal and sensitive admin operations. | Verified Stripe delivery succeeds; invalid/replayed events remain rejected. |
| Scheduled jobs | Add Cron-backed database-idempotent notifications, expiry, reconciliation and alerts only after the underlying workflows exist. | Authenticated invocation, duplicate-run handling, durable job records and alerts pass in non-production. |
| Advanced workflow decision | Consider Workflows/Queues only if Cron plus durable database jobs cannot handle required orchestration. | Written cost, failure, ownership and alternative analysis. |

Release 1 account-link delivery is the first deployed scheduled job: Vercel invokes `/api/cron/account-delivery` every five minutes, authenticated by the server-only `CRON_SECRET`, and each run processes no more than 20 leased outbox records. Non-production verification must include authentication rejection, bounded multi-record processing, retry continuation, overlapping claims, permanent token ineligibility, and secret/PII-safe responses and evidence.

The Release 1 automated suite covers cross-account denial, administrator and Super Admin escalation denial, canonical-country and conditional-official-field validation, classification combinations, normalized email usernames, password-response redaction, account-state policy, absence of IDOC starter-team creation, verification/recovery/activation token handling, onboarding and profile ownership/history, retryable notification evidence, and Stripe identity preservation boundaries. The isolated database command is separate from unit checks, rebuilds only the disposable database's `idoc` schema, executes every migration, and must pass before Release 1 closes. It validates the target before destructive SQL and refuses an ambiguously production-like database URL. Release 1 remains open until the complete database-backed matrix and latest-head review gates pass.

### Supported isolated PostgreSQL invocation

- Local default: run `pnpm test:integration-db`. The command starts a disposable `postgres:16-alpine` Docker container, creates a uniquely named `idoc_test_<random>` database, validates the resulting URL, runs the suite, and removes only that container.
- Existing isolated service or CI service container: set `TEST_DATABASE_URL` to a dedicated PostgreSQL database named exactly `idoc_test`, prefixed `idoc_test_`, or suffixed `_idoc_test`, then run `pnpm test:integration-db`. The validator runs before the suite can drop the `idoc` schema. The value must not match `POSTGRES_URL`.
- GitHub Actions runs `pnpm check:release1` against a disposable PostgreSQL 16 service container with workflow-local test credentials. The workflow has read-only repository contents permission, does not define `POSTGRES_URL`, and never connects to Render.
- `pnpm check:release1` uses the same provision-or-receive behavior. Missing Docker and a missing explicit test URL is a hard failure, never a skipped database suite.

| **Scenario**                                  | **Expected result**                                                            |
|-----------------------------------------------|--------------------------------------------------------------------------------|
| Existing active Stripe member logs in         | Sees active membership and correct professional role; no repurchase requested. |
| Existing Stripe member canceled at period end | Sees active through valid-until date and non-renewing billing state.           |
| Stripe renewal succeeds                       | One payment recorded; membership extended once.                                |\n| One-time €80 Stripe payment succeeds           | Payment-mode Checkout and verified webhook record one payment; a new 12-month term is granted once. |
| Stripe webhook delivered twice                | No duplicate payment or duplicate extension.                                   |
| Stripe payment fails                          | Configured grace/notification behavior occurs.                                 |
| Automatic renewal fails                       | Stripe retry occurs; member remains active for five days, then becomes expired if unpaid. |
| Early renewal                                 | Exactly 12 months is added to the existing paid-through date.                  |
| Late renewal                                  | New 12-month term begins on the actual successful payment date.                |
| Bank-transfer member logs in                  | Sees active membership without Stripe subscription.                            |
| Admin records bank transfer                   | Payment + entitlement change + audit entry committed together.                 |
| Judge + Steward member                        | Both roles and separate levels display correctly.                              |
| Each of four signup choices                    | Shows and requires exactly the approved common and conditional fields.          |
| Veterinarian signup                            | Requires only the common member fields and does not require official fields.    |
| Invalid Judge/Steward status or IDOC Region    | Rejected by server-side validation even if submitted outside the browser form.  |
| Country and National Federation                | Use the same complete canonical country list and store valid canonical codes.   |
| Classification change                         | Revalidates newly required fields, preserves role history, and does not alter membership billing. |
| Member changes signup/professional field      | Change is server-validated, history is retained, and administrators are notified. |
| Member changes email/username                 | New address must be verified; Stripe Customer email is updated without changing Customer/Subscription linkage. |
| Member guesses another member ID              | Private data remains inaccessible.                                             |
| Unmatched legacy Stripe subscription          | Appears in migration exception report, not silently discarded.                 |
| Expired legacy member                         | Account can exist but restricted member entitlement is denied.                 |\n| CMS/seminar audience set to Match any          | A member with any selected classification is eligible.                         |\n| CMS/seminar audience set to Match all          | Only a member holding every selected classification is eligible.               |

# 3. Migration rehearsal requirements

- Run the complete import from a fresh legacy export at least once before production.

- Produce row counts and hashes/identifiers sufficient to prove the same input produces the same migration result.

- Record duration and manual exception count, but do not design cutover around an untested one-off script.

- Test duplicate handling, malformed fields and failed rows deliberately.

- Verify a sample across every payment type and professional category.

- Independently compare a sample of migrated Stripe subscriptions against the Stripe Dashboard/API.

# 4. Production cutover checklist

1. Announce administrative change freeze or define how last-minute changes are captured.

2. Take final backups/export of WordPress/MemberPress data.

3. Capture final Stripe-linked migration snapshot and preserve raw export files securely.

4. Run production import in non-destructive/idempotent mode.

5. Run reconciliation report and resolve all launch-blocking exceptions.

6. Configure production Stripe webhook to the new Vercel endpoint.

7. Verify webhook signature secret and send/test a controlled event where feasible.

8. Verify production environment variables and ensure preview deployments do not share inappropriate secrets.

9. Run smoke tests for existing Stripe, manual-pay, expired and administrator accounts.

10. Switch idoc.club routing/DNS as planned.

11. Run immediate post-cutover membership and Stripe reconciliation.

12. Keep the legacy IDOC WordPress/MemberPress interface runnable and read-only throughout the stabilization period so routing rollback is immediately possible. After the complete-project public launch is accepted and rollback closure is approved, preserve the archival backup/export and retire the legacy site.

# 5. Rollback triggers

- Material number of active members cannot authenticate or are shown inactive incorrectly.

- Production webhook verification or processing is unreliable and cannot be safely isolated.

- Evidence of authorization or member-data-isolation failure.

- Reconciliation reveals unexplained loss/mismatch of active Stripe subscriptions or membership entitlements.

- Critical admin workflow corrupts membership validity or payment records.

# 6. Rollback approach

Because existing Stripe subscriptions are not canceled/recreated, rollback is principally an application/data-routing problem rather than a billing migration reversal. Revert site routing to the known-good legacy interface, disable new mutating endpoints if necessary, preserve the new database for analysis, and reconcile any post-cutover payment/admin events before attempting a second cutover.

# 7. Post-launch monitoring

- Webhook processing failures and dead-letter/retry queue if implemented.

- Failed renewal rate and members in grace.

- Unlinked or conflicting Stripe subscription records.

- Unexpected spikes in account activation/recovery failures.

- Admin audit activity and unusual privilege changes.

- Database/API errors affecting membership pages.

- Manual-payment records created without expected supporting references/reasons.

# 8. Definition of done

| **Area**   | **Done when**                                                                                               |
|------------|-------------------------------------------------------------------------------------------------------------|
| Migration  | Every source member has an approved disposition and reconciliation is signed.                               |
| Billing    | Existing Stripe subscriptions are linked and recurring events are processed idempotently.                   |
| Membership | All supported payment channels can produce correct entitlement.                                             |
| Security   | Security acceptance checklist passes.                                                                       |
| Operations | Administrator runbook is usable by the people who will operate the site.                                    |
| Legacy     | Legacy system is retained only as long as required for rollback/audit, then safely decommissioned for IDOC. |

## Release 1 corrective verification

The database suite accepts only a provisioned or explicit PostgreSQL `TEST_DATABASE_URL` whose database name is exactly `idoc_test` or uses a delimited `idoc_test_…`/`…_idoc_test` convention. It rejects malformed URLs, ambiguous hosts/names, Render or production-like targets, and a target matching `POSTGRES_URL` before destructive SQL. Destination comparison ignores credentials, PostgreSQL scheme aliases, query/SSL decoration, fragments, host case, encoded database spelling, IPv6 brackets, and an omitted default port. `rejected database destinations preserve real sentinel schema, table, and row data` and `equivalent destination decoration cannot bypass validation before destructive SQL` instrument the suite boundary and prove the sentinel PostgreSQL objects survive every rejection.

The suite includes concurrent rate-limit increments, competing/expired outbox lease claims, migration upgrades, and `final migrated catalog exactly agrees with the authoritative Drizzle snapshot`. That catalog test applies all migrations to an empty disposable PostgreSQL database and compares schemas, tables, ordered columns, PostgreSQL types, defaults, nullability, primary/unique/check constraints, foreign-key targets/actions, complete indexes (including expression/partial indexes), identity/generated state, triggers, and enum/check semantics with `schema.ts` and `meta/0009_snapshot.json`. Migration `0009` is forward-only and reconciles historical constraint names; released migrations are not rewritten.

`lib/db/migrations/released-checksums.json` protects every released migration through `0008`, each corresponding snapshot, and each historical journal entry with deterministic SHA-256 hashes. `released migrations, snapshots, and journal entries retain their committed checksums` reports the repository-relative path of an unexpected change. A later migration and snapshot may be added deliberately above `releasedThrough`; promoting it to released status requires deliberately adding its hashes without changing protection for earlier files. `pnpm check:release1` is the aggregate local gate; provisioning failure is explicit and never becomes a skipped suite.

The authoritative, requirement-level verification status is maintained in [the Release 1 verification matrix](11-release-1-verification-matrix.md). A unit test or source-text assertion is supplemental evidence only. Any matrix row without a passing PostgreSQL behavioral test remains open and prevents Release 1 closure.
