**IDOC**

**Product Roadmap & Functional Requirements**

From the deployed raw starter to membership launch, restricted content, seminars, news, and blog publishing

| **Field**         | **Value**                                                                                                         |
|-------------------|-------------------------------------------------------------------------------------------------------------------|
| Organization      | International Dressage Officials Club (IDOC)                                                                      |
| Current platform  | WordPress Multisite + MemberPress                                                                                 |
| Target platform   | Next.js on Vercel + Render PostgreSQL (dedicated idoc schema) + Stripe + Brevo                                    |
| Current state     | Raw subscription starter deployed; database connection and isolated IDOC migrations working                       |
| Annual membership | €80; one club membership regardless of professional classification                                                |
| Document status   | Authoritative delivery map; policy items marked Decision required must be approved before affected implementation |

# 1. Purpose and governing principles

This document translates the approved project direction into an ordered product delivery map. It defines what must be built, why the order matters, what each release must prove, and which unresolved decisions block implementation. The original documents continue to govern their specialized subjects; this document governs sequencing and requirement traceability.

- Launch the membership replacement first and stabilize it before expanding the product.

- Use one €80 annual membership; professional classification controls data and content access, not price.

- Represent Judge and Steward as independent historical roles. Judge + Steward is two simultaneous roles, not a destructive combined type.

- Keep membership entitlement separate from authentication, professional roles, Stripe subscription state, and seminar registration.

- Treat manual payments as first-class auditable payments.

- Preserve existing legitimate Stripe subscriptions and imported member entitlements.

- Restrict every migration action to IDOC data in WordPress Multisite; unrelated network sites remain untouched.

# 2. Product releases

| **Release** | **Outcome**                       | **Included scope**                                                                                                                            |
|-------------|-----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| Release 0   | Approved specification            | Business rules, complete field dictionary, editable/verified field matrix, renewal/grace/notice policy, roles and permissions.                |
| Release 1   | Membership foundation             | IDOC schema, authorization, account lifecycle, profiles, professional roles/history, membership entitlement, audit and automated tests.       |
| Release 2   | Membership billing and operations | €80 Stripe enrollment, renewal controls, Customer Portal, manual payments, Brevo notifications, dashboard, administration and reconciliation. |
| Release 3   | Migrated membership launch        | Repeatable IDOC-only import, staging rehearsal, reconciliation, activation, cutover, monitoring and read-only legacy retention.               |
| Release 4   | Restricted CMS                    | Page authoring, revisions, publishing, media/SEO data and audience access.                                                                    |
| Release 5   | Seminars                          | Seminar authoring, eligibility/capacity, registration, Stripe/manual payments, attendance, refunds, reminders and reports.                    |
| Release 6   | News and blog                     | President/editor publishing, drafts, scheduling, taxonomy, featured media, SEO and optional restrictions.                                     |

# 3. Phase 0 - decisions and data dictionary

This is the immediate next step. No production membership schema or conditional signup form should be treated as final until these decisions are approved.

| **Decision area**         | **Required output**                                                                                    | **Status**        |
|---------------------------|--------------------------------------------------------------------------------------------------------|-------------------|
| Common member fields      | Email/username, name, and complete address as defined in document 02.                                  | Approved; edit permissions and migration source mapping remain to be confirmed |
| Judge fields              | Common official fields, approved Judge status, and Technical Delegate answer as defined in document 02. | Approved; edit/verification rules remain to be confirmed |
| Steward fields            | Common official fields and approved Steward status as defined in document 02.                          | Approved; edit/verification rules remain to be confirmed |
| Veterinarian fields       | Only the fields required for every member.                                                             | Approved |
| Membership calendar       | Rolling 12 months; preserve every existing member's current paid-through/expiration date during migration. Late/early/manual renewal calculations remain to be confirmed. | Approved policy; edge-case calculations remain |
| Renewal choice            | Whether recurring is default/optional and whether online one-time payment is offered.                  | Decision required |
| Notices and grace         | Notice timing, failed-payment grace duration, access behavior and escalation.                          | Decision required |
| Administrator permissions | Membership, billing, content/editor and system roles; high-risk approvals.                             | Decision required |
| Manual exceptions         | Discounts, partial payments, complimentary grants, evidence and approval thresholds.                   | Decision required |

# 4. Release 1 - membership foundation

1.  Remove or adapt generic team/invitation concepts that do not represent IDOC.

2.  Implement profiles, memberships, professional role history, change requests, administrator permissions, audit log, migration map, and Stripe-event idempotency records in the Render idoc schema.

3.  Implement secure signup, verified email, login/logout, password change, neutral password recovery/reset, session handling, and migrated-member activation.

4.  Enforce server-side ownership and administrator authorization for every read and write.

5.  Implement the common member form plus conditional Judge, Steward, Judge + Steward, and Veterinarian fields from the approved dictionary.

6.  Implement classification change requests so adding or ending a role preserves history.

7.  Pass cross-account, role-escalation, validation, audit, and membership-entitlement automated tests.

# 5. Release 2 - billing, manual payments, dashboard, and administration

8.  Create/use one canonical €80 annual Stripe Price for new recurring memberships; retain historical Price IDs for valid imported subscriptions.

9.  Implement Stripe Checkout, verified idempotent webhooks, local subscription/payment projection, failed-payment behavior, cancel-at-period-end, and reconciliation.

10. Provide an ownership-verified Stripe Customer Portal for payment-method and permitted subscription changes.

11. Implement renewal preference/status and upcoming renewal/expiration notifications through Brevo, with delivery history.

12. Implement manual cash, bank transfer, PayPal, complimentary, waived/discounted, and other approved payment recording. Payment, entitlement change, and audit entry commit together.

13. Build member dashboard: membership status, paid-through/renewal date, auto-renew status, portal access, payment history, permitted profile edits, security controls, professional information and change requests.

14. Build administrator tools: member search, profile correction, roles/levels, change-request review, manual payments, entitlement correction, suspension/reinstatement, audit, exports, notification history and Stripe reconciliation.

15. Complete Stripe test-mode and manual-payment lifecycle testing before using live billing.

# 6. Release 3 - migration and membership launch

16. Export only IDOC users and relevant metadata from the WordPress Multisite network plus IDOC MemberPress memberships, subscriptions and transactions.

17. Import profiles, roles, membership state, manual payments, legacy IDs, Stripe Customer/Subscription IDs, and paid-through dates with deterministic mapping and exception reporting.

18. Pre-create account identities and send activation instructions; do not ask migrated members to register or repay.

19. Run a full staging rehearsal and reconcile member counts, classifications, entitlement, Stripe subscriptions, manual payments, duplicates and exceptions.

20. Obtain IDOC acceptance; freeze legacy IDOC membership changes; take final backups/exports; rerun the idempotent import; switch the production webhook; launch.

21. Monitor errors, webhooks, notifications and discrepancies; retain the old IDOC membership function read-only for the approved stabilization period.

22. Decommission only IDOC-specific MemberPress/webhook/jobs after acceptance; do not affect any unrelated multisite site.

# 7. Release 4 - restricted CMS

- Page fields: title, slug, structured/rich body, summary, status, author, revision, publish/schedule dates, featured media, SEO title/description and audit metadata.

- Audiences: public, any active member, Judge, Steward, Judge or Steward, Judge and Steward, Veterinarian, administrator, and approved combinations.

- Access is evaluated server-side from current membership and active professional roles. Restricted content must not leak through public caches, previews, feeds, sitemaps, APIs, or search indexing.

- Editorial workflow: draft, preview, review if adopted, publish, revise, unpublish/archive, and audit.

# 8. Release 5 - seminars

- Seminar data: title, description, presenter, dates/times/time zone, venue/online details, capacity, registration window, eligibility, prices, cancellation/refund policy and communications.

- Registration: authenticated member or approved public/nonmember path, eligibility validation, concurrency-safe capacity, waitlist if adopted, consent fields, payment state, confirmation and attendance.

- Payments: application-created Stripe Checkout and approved manual methods. Seminar payments are classified separately and never alter membership entitlement.

- Operations: attendee lists/exports, reminders, cancellations, refunds, transfers if adopted, attendance and reconciliation.

# 9. Release 6 - news and blog

- News and blog article types with author, draft/published/scheduled state, publication date, featured media, categories/tags, SEO fields and revisions.

- President and approved editors receive least-privilege authoring/publishing permissions.

- Articles are public by default when intended, with optional use of the same audience restriction system as CMS pages.

# 10. Cross-cutting acceptance gates

| **Gate**            | **Pass condition**                                                                                                                          |
|---------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| Architecture        | Production uses Vercel, Render PostgreSQL idoc schema with isolated Drizzle ledger/TLS, server-only credentials, Stripe and Brevo.          |
| Authorization       | Cross-member reads/writes and client-driven privilege escalation fail; restricted content is not cached publicly.                           |
| Billing integrity   | Webhook replay cannot duplicate payment or entitlement; manual payment commits atomically; seminar billing cannot affect membership.        |
| Migration integrity | Every in-scope legacy record has a disposition; counts and financial/entitlement totals reconcile; unrelated multisite sites are unchanged. |
| Member experience   | Existing members activate access without repurchase; new members complete one conditional signup and one €80 payment path.                  |
| Operations          | Administrators can resolve normal cases without direct database edits and all sensitive changes are auditable.                              |
| Launch readiness    | Backups, rollback, monitoring, notification delivery, admin training, acceptance checklist and support procedure are complete.              |

## 10.1 Security architecture required before import

The starter must be hardened before production data is imported. The required trust chain is application authentication, explicit server-side authorization at every data-access boundary, authorized Render PostgreSQL access, and IDOC membership/role entitlement. Stripe follows a separate verified-webhook path and never serves as the authorization system.

- Every Server Action, Route Handler, API endpoint, background job, and private server-rendered read enforces ownership or administrator permissions server-side.

- Browsers never receive database/authentication/Stripe/Brevo secrets and never supply trusted active-subscription, membership, professional-level, or administrator state.

- Input validation, rate limiting, security headers, secure sessions/cookies, audit logging, enumeration resistance, webhook verification/idempotency, least-privilege database access, backups/recovery, and time-bounded migration tooling are launch requirements.

- PostgreSQL RLS is an optional additional layer only if authenticated identity can be bound safely to each transaction; the system does not claim database-layer policies that are not actually implemented in the Render architecture.

# 11. Requirement-to-document ownership

| **Subject**                                           | **Authoritative document**                                |
|-------------------------------------------------------|-----------------------------------------------------------|
| Scope, objectives and success                         | 00 Project Charter & Scope                                |
| Architecture and data model                           | 01 Solution Architecture & Data Model                     |
| Membership, renewal and manual-payment rules          | 02 Membership & Payment Business Rules                    |
| WordPress Multisite/MemberPress migration             | 03 Legacy Data Migration & Reconciliation Plan            |
| Stripe preservation and billing                       | 04 Stripe Subscription Preservation & Billing Integration |
| Security and privacy                                  | 05 Security & Privacy Requirements                        |
| Implementation, testing and cutover                   | 06 Implementation, Testing & Cutover Plan                 |
| Day-to-day administration                             | 07 Administrator & Operations Runbook                     |
| Sequencing, expanded functional scope and phase gates | 08 Product Roadmap & Functional Requirements              |

# 12. Immediate next action

The required signup fields, permitted status values and rolling 12-month membership calendar are approved in document 02. Complete the remaining Phase 0 decisions: field edit permissions, migration-source mapping, early/late/manual renewal calculations, renewal choice, notice/grace timing, administrator permissions, and manual-payment exception rules. Then begin Release 1. Stripe live integration, production migration, CMS, seminars, and publishing must follow their defined gates rather than being developed against assumptions.
