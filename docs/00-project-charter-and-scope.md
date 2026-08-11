**IDOC**

**Project Charter & Scope**

Migration from WordPress Multisite + MemberPress to a purpose-built Next.js membership platform

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.1                                            |
| **Date**             | 11 August 2026                                 |

Working project document. Update this document when project decisions change.

# 1. Purpose

This charter defines the objective, scope, constraints, major decisions, success criteria, and governance for replacing the current IDOC membership implementation on WordPress Multisite/MemberPress with a Next.js application deployed on Vercel.

# 2. Project objectives

- Preserve every legitimate existing member account without requiring members to create a new membership.

- Preserve existing Stripe subscriptions in place wherever possible, rather than canceling and recreating them.

- Support members who paid by Stripe, PayPal, bank transfer, cash/in person, or other manually recorded methods.

- Represent dressage judges, stewards, combined judge/stewards, and veterinarians, including their respective levels where applicable.

- Use one common annual membership price of €80 for new paid memberships unless IDOC later changes the fee.

- Separate authentication, membership entitlement, professional classification, and billing so none of those concepts is incorrectly used as a substitute for another.

- Provide a secure administrative workflow for member management, payment reconciliation, professional level changes, and audit history.

- Complete migration with a controlled cutover, reconciliation, rollback plan, and post-launch verification.

# 3. Core business rules

| **Rule**                | **Project interpretation**                                                                                                                      |
|-------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| Annual price            | €80 for all standard paid memberships.                                                                                                          |
| Professional categories | Judge, Steward, Judge + Steward, Veterinarian.                                                                                                  |
| Levels                  | Stored as profile/membership attributes; not separate Stripe products unless pricing later differs.                                             |
| Active membership       | Determined by an IDOC membership record and its validity/status, not solely by Stripe.                                                          |
| Stripe subscriptions    | Existing subscriptions remain attached to their current Stripe Customer/Subscription objects unless a specific exception requires intervention. |
| Manual payments         | Can activate or extend membership without requiring a Stripe subscription.                                                                      |
| Existing users          | Accounts are pre-created/imported. Members should only need to authenticate/activate access, not re-enroll or repay.                            |
| Administrative changes  | All sensitive changes are server-authorized and auditable.                                                                                      |

# 4. In scope

- New Next.js membership application and public/member/admin interfaces required for the membership function.

- Render PostgreSQL data model in the dedicated idoc schema, Drizzle migration integration, and the application's database-backed authentication integration.

- Stripe Checkout/Customer Portal for new Stripe payments and self-service billing where appropriate.

- Import of WordPress users, MemberPress memberships, transactions, and subscription references.

- Matching imported members to Stripe Customers and active/historical Stripe Subscriptions.

- Manual-payment records and administrator renewal/extension workflows.

- Member-facing profile, membership status, renewal and billing views.

- Administrator member search, classification/level management, payment status management, audit history, and exception review.

- Security hardening, test plans, migration rehearsal, production cutover, and operational documentation.

# 5. Explicitly out of scope unless added later

- Changing the annual fee or creating differential pricing by official type/level.

- Moving existing Stripe subscriptions to a different Stripe account.

- Canceling and re-creating existing Stripe subscriptions merely to normalize Price IDs.

- Requiring members to repeat profile data already available and trustworthy in the legacy system.

- A full replacement of unrelated WordPress Multisite sites on the same network.

- Features unrelated to membership that are not identified during discovery.

# 6. Success criteria

| **Area**           | **Acceptance criterion**                                                                                                                                                          |
|--------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Account continuity | Every in-scope legacy member is represented in the new database with a deterministic migration disposition.                                                                       |
| Stripe continuity  | Matched active Stripe subscriptions continue billing without cancellation/recreation caused by the migration.                                                                     |
| Entitlements       | Active/inactive access in the new site matches the approved migration rules and reconciliation report.                                                                            |
| Manual payments    | Administrators can accurately represent active memberships paid outside Stripe.                                                                                                   |
| Security           | Server-side authorization, member-data isolation, webhook verification, secret management, input validation, rate limiting, logging and production security controls pass review. |
| Cutover            | Production launch has a tested rollback procedure and signed reconciliation checklist.                                                                                            |
| Member experience  | Existing members do not need to buy membership again; first access is an account-access step only.                                                                                |

# 7. Project roles

| **Role**                            | **Responsibilities**                                                                                 |
|-------------------------------------|------------------------------------------------------------------------------------------------------|
| Project owner / IDOC decision maker | Approves business rules, membership validity rules, exceptional cases and launch.                    |
| Developer / technical owner         | Architecture, implementation, migration tooling, testing, deployment and operational handoff.        |
| Membership administrator            | Validates member categories/levels, payment exceptions, manual renewals and migration discrepancies. |
| Stripe account administrator        | Provides production Stripe access, webhook configuration and reconciliation approval.                |
| Test users                          | Validate representative member and administrator workflows before launch.                            |

# 8. Required decisions before production migration

1. Confirm the official membership period rule: rolling 12 months from payment/renewal versus a fixed annual membership cycle.

2. Confirm how grace periods and failed Stripe payments affect access.

3. Confirm which legacy MemberPress statuses should map to active, expired, canceled, complimentary, suspended, or review-required.

4. Confirm the allowed judge and steward level values and whether historical level changes need to be retained.

5. Confirm whether veterinarians have any level/certification fields.

6. Confirm whether PayPal will remain a supported new-payment method or only be preserved as a historical/manual payment source.

7. Confirm the administrative roles and which actions each role is permitted to perform.

# 9. Deliverables

- Solution Architecture & Data Model

- Membership & Payment Business Rules

- Legacy Data Migration & Reconciliation Plan

- Stripe Subscription Preservation & Billing Integration

- Security & Privacy Requirements

- Implementation Plan, Test Strategy & Cutover

- Administrator & Operations Runbook
