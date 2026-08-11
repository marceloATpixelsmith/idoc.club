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
| 9\. Post-launch          | Monitoring, exception cleanup, legacy read-only support.                                                                                                                     | Stabilization acceptance.                           |

# 2. Test matrix

| **Scenario**                                  | **Expected result**                                                            |
|-----------------------------------------------|--------------------------------------------------------------------------------|
| Existing active Stripe member logs in         | Sees active membership and correct professional role; no repurchase requested. |
| Existing Stripe member canceled at period end | Sees active through valid-until date and non-renewing billing state.           |
| Stripe renewal succeeds                       | One payment recorded; membership extended once.                                |
| Stripe webhook delivered twice                | No duplicate payment or duplicate extension.                                   |
| Stripe payment fails                          | Configured grace/notification behavior occurs.                                 |
| Bank-transfer member logs in                  | Sees active membership without Stripe subscription.                            |
| Admin records bank transfer                   | Payment + entitlement change + audit entry committed together.                 |
| Judge + Steward member                        | Both roles and separate levels display correctly.                              |
| Each of four signup choices                    | Shows and requires exactly the approved common and conditional fields.          |
| Veterinarian signup                            | Requires only the common member fields and does not require official fields.    |
| Invalid Judge/Steward status or IDOC Region    | Rejected by server-side validation even if submitted outside the browser form.  |
| Country and National Federation                | Use the same complete canonical country list and store valid canonical codes.   |
| Classification change                         | Revalidates newly required fields, preserves role history, and does not alter membership billing. |
| Member tries to change own level              | Request rejected unless that field is explicitly self-service.                 |
| Member guesses another member ID              | Private data remains inaccessible.                                             |
| Unmatched legacy Stripe subscription          | Appears in migration exception report, not silently discarded.                 |
| Expired legacy member                         | Account can exist but restricted member entitlement is denied.                 |

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

12. Place legacy WordPress IDOC membership UI in read-only/maintenance state rather than deleting it.

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
