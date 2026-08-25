**IDOC**

**Product Roadmap & Functional Requirements**

From the deployed raw starter to membership launch, restricted content, seminars, news, and blog publishing

| **Field**         | **Value**                                                                                                         |
|-------------------|-------------------------------------------------------------------------------------------------------------------|
| Organization      | International Dressage Officials Club (IDOC)                                                                      |
| Current platform  | WordPress Multisite + MemberPress                                                                                 |
| Target platform   | Next.js on Vercel + Render PostgreSQL (dedicated idoc schema) + Stripe + Mailchimp Transactional                 |
| Current state     | Raw subscription starter deployed; database connection and isolated IDOC migrations working                       |
| Annual membership | €80; one club membership regardless of professional classification                                                |
| Document status   | Authoritative delivery map; approved policy is ready for implementation |

# 1. Purpose and governing principles

This document translates the approved project direction into an ordered product delivery map. It defines what must be built, why the order matters, what each release must prove, and which unresolved decisions block implementation. The original documents continue to govern their specialized subjects; this document governs sequencing and requirement traceability.

- Launch the complete project scope together: membership, restricted CMS, seminars, news and blog, following the internal implementation gates below.

- Use one €80 annual membership; professional classification controls data and content access, not price.

- Represent Judge and Steward as independent historical roles. Judge + Steward is two simultaneous roles, not a destructive combined type.

- Keep membership entitlement separate from authentication, professional roles, Stripe subscription state, and seminar registration.

- Treat manual payments as first-class auditable payments.

- Preserve existing legitimate Stripe subscriptions and imported member entitlements.

- Restrict every migration action to IDOC data in WordPress Multisite; unrelated network sites remain untouched.

# 2. Product releases

| **Release** | **Outcome**                       | **Included scope**                                                                                                                            |
|-------------|-----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| Release 0   | Approved specification            | Business rules, complete field dictionary, renewal/grace/notice policy, roles and permissions.                                                  |
| Release 1   | Membership foundation             | IDOC schema, authorization, account lifecycle, profiles, professional roles/history, membership entitlement, audit and automated tests.       |
| Release 2   | Membership billing and operations | €80 Stripe enrollment, renewal controls, Customer Portal, manual payments, Mailchimp Transactional notifications, dashboard, administration and reconciliation. |
| Release 3   | Migrated membership readiness     | Repeatable IDOC-only import, staging rehearsal, reconciliation, activation and internal acceptance. No public routing cutover occurs until Releases 4–6 are complete. |
| Release 4   | Restricted CMS                    | Page authoring, revisions, publishing, media/SEO data and audience access.                                                                    |
| Release 5   | Seminars                          | Seminar authoring, eligibility/capacity, registration, Stripe/manual payments, attendance, refunds, reminders and reports.                    |
| Release 6   | Complete-project public launch     | News/blog publishing plus final whole-product acceptance, production routing cutover, monitoring and post-stabilization legacy retirement. |

# 3. Phase 0 - decisions and data dictionary

All core membership-policy decisions in this section are approved. No production membership schema or conditional signup form should diverge from them.

| **Decision area**         | **Required output**                                                                                    | **Status**        |
|---------------------------|--------------------------------------------------------------------------------------------------------|-------------------|
| Common member fields      | Email/username, name, and complete address, with optional Address 2, as defined in document 02.        | Approved |
| Judge fields              | Common official fields, approved Judge status, and Technical Delegate answer as defined in document 02. | Approved |
| Steward fields            | Common official fields and approved Steward status as defined in document 02.                          | Approved |
| Veterinarian fields       | Only the fields required for every member.                                                             | Approved |
| Membership calendar       | Rolling 12 months; early renewal extends from current expiry; late renewal starts on actual payment date; preserve imported dates. | Approved |
| Renewal choice            | Auto-renewal or one-time payment; auto selected by default.                                            | Approved |
| Notices and grace         | Auto notice 15 days before; non-auto notice 30 days before; five-day active grace after automatic-payment failure. | Approved |
| Administrator permissions | Administrator has full application access; Super Admin additionally holds restricted settings/functions. | Approved |
| Manual exceptions         | EUR only; no discount, partial or waived payments; any admin may grant an audited complimentary membership. | Approved |

# 4. Release 1 - membership foundation

Implementation status: the foundation now additionally includes generated migration metadata through `0008`, destination-based strict test-database URL validation, automatic disposable PostgreSQL provisioning, purpose-separated persistent recovery/activation limits, deterministic timing equalization, version-aware encrypted durable account-link delivery, database-backed account-function checks, a protected five-minute Vercel Cron worker, and token-eligible lease-based concurrent outbox claiming with bounded retry/dead-letter behavior. Behavioral verification batch 1 adds focused PostgreSQL coverage for persisted account access, profile ownership, approved profile creation, classification transitions, immutable evidence, and profile-transaction rollback. Its latest-head disposable-PostgreSQL workflow passed. Behavioral verification batch 2 adds application-boundary coverage for email verification and graph preservation, canonical edit validation, onboarding rollback, password recovery/reset, session invalidation, and imported-classification activation/reconciliation; document 11 keeps incomplete matrix cases explicitly open until the batch 2 latest-head workflow passes. The next corrective batch adds a forward-only schema-name reconciliation, exact PostgreSQL catalog comparison, released-history SHA-256 protection, and sentinel-backed destructive-target tests; these new rows remain pending until the corrective pull request latest-head workflow passes. Existing password reset, migrated activation, profile editing, session revocation, history, entitlement, and migration foundations remain in place. A signup UI/UX rebuild (item 3) replaces the single-page signup form with a three-step flow (email, 6-digit OTP, password) behind a shared branded auth shell (`components/auth/auth-shell.tsx`) reused across signup/login/password-reset, backed by a new purpose-scoped `email_otp_codes` table (migration `0015`), a signed short-lived `idoc_pending_signup` cookie so no `users` row exists before the password step, Cloudflare Turnstile bot-checking on the email step, and a stricter `passwordSchema` (10-character minimum, upper/lower/digit/special-character, sequential/repeated-run rejection) enforced identically client- and server-side. `app/(login)/sign-up` is now dynamic (its rendered step depends on the pending-signup cookie), not a static partial-prerender shell. The equivalent login rebuild is also complete — `app/(login)/sign-in/actions.ts`'s `startLogin` looks up the account by email and branches three ways: not-found/suspended returns a generic error with no password step (login is deliberately *not* neutral about account existence here, unlike the anonymous recovery/activation boundary in `lib/membership/account-recovery.ts`, which stays neutral, matching the explicit product requirement that a login flow may reveal whether the entered email has an account); a `migrated_pending` legacy pre-launch member gets the same OTP-verification step as signup (purpose `login_verification`), then sets a new password through `activateMigratedAccountByUserId` — a new entry point that reuses `consumeAccountToken`'s foundation-validation logic (split out into `validateMigrationActivationFoundation`/`applyMigrationActivationMutation`) but is driven by a verified OTP instead of an email-link token, with the same validate-before-claim ordering and an atomic `accountState = 'migrated_pending'`-conditioned UPDATE closing the race a concurrent double-submission could otherwise exploit; every other account state goes straight to a password field reusing the existing, unchanged `signIn` action. A newly activated legacy member lands on `/dashboard/profile?confirmDetails=1` (their imported profile, pre-filled, with a confirmation banner) instead of a blank onboarding form. State is tracked in a new signed `idoc_pending_login` cookie, making `/sign-in` dynamic too. The old email-link migration-activation pages (`/request-activation`, `/activate`) are untouched and still function as a support-only fallback, just no longer linked from the primary UI. The equivalent OTP-based password-reset rebuild (`/recover-password`, reusing the neutral-anonymous-boundary pattern) is also complete. The professional-type/demographics onboarding UI restyle (`app/(dashboard)/onboarding/onboarding-wizard.tsx`) is also complete — a two-step wizard (official-type cards, then demographics) on the same shell. A detailed follow-up specification (documented in docs/02 §1.2-1.3 and docs/05's rate-limiting/device-trust/TOTP sections) still includes independent IP- and email-keyed rate limiting, redirecting a newly onboarded member to the payment step before the dashboard, blocking signup for an already-registered email with a "you already have an account" notice email, and a device-trust "remember me for 2 weeks" cookie for ordinary returning members. Privileged Administrator/Super Admin TOTP enrollment and login is now implemented for both password and Google primary authentication, with no device-trust bypass; privileged password-reset MFA remains unfinished. Onboarding now requires Terms-of-Service and Privacy-Policy acceptance, durably records the submitted acceptance timestamps and optional "Keep me updated" choice, and best-effort subscribes opted-in members to the Mailchimp Marketing audience. The optional checkbox is checked by default, and existing/imported profiles receive no fabricated consent record. The email-step/OTP-step/password-step components are also being consolidated from three near-identical per-flow copies (signup, login, password-reset) into shared components parameterized by the caller's action and DB effect. Release 1 is **not yet closed**. The traceable matrix in document 11 records the remaining PostgreSQL behavioral gaps; every required verification command, deployment/UAT gate, and latest-head Codex review must also complete before closure.

Durable canonical MFA persistence is implemented through migration `0020` and the trusted PostgreSQL `PostgresMfaStore`, including atomic enrollment/challenge consumption, counter replay prevention, single-use recovery-code digests, and revocable expiring remembered-device digests. The live privileged-login slice now also enforces canonical TOTP enrollment and `login` challenges for database-granted Administrators and Super Admins after both password and Google primary authentication, and a normal session is not issued until MFA succeeds (plus recovery-code acknowledgement for first enrollment). Password-reset MFA, recovery-authorized factor replacement, generic sensitive-action step-up, account-security management UI, broader notification/session-revocation integration, member remembered-device behavior, and production key deployment/UAT remain unfinished release gates.

Google OIDC is part of the Release 1 authentication scope under the canonical `pixelsmith-auth-reference` contract `1.10.0`. The enabled slice includes the Google login/signup routes, PKCE/state/nonce provider validation, browser-bound login-CSRF protection, origin rate limiting, bounded OAuth-transaction retention, persistent issuer+subject external identities, canonical privileged-MFA enforcement after Google primary authentication, and canonical session establishment only after any required MFA succeeds. Google authentication is still not release-complete by itself: before launch, existing-account Google linking must have an explicit authenticated/fresh-verification flow with collision checks and notification, unlink/lifecycle behavior must be defined and tested, generic fresh-step-up coverage for sensitive actions remains unfinished, the three Google deployment variables and exact callback URI must be configured in production, and end-to-end Google Cloud/UAT plus latest-head security review must pass. Automatic email-only linking remains prohibited.

1.  Remove or adapt generic team/invitation concepts that do not represent IDOC.

2.  Implement profiles, memberships, professional role history, change requests, administrator permissions, audit log, migration map, and Stripe-event idempotency records in the Render idoc schema.

3.  Implement secure signup, verified email, login/logout, password change, neutral password recovery/reset, session handling, migrated-member activation, and canonical Google OIDC authentication with its remaining account-linking/lifecycle launch gates.

4.  Enforce server-side ownership and administrator authorization for every read and write.

5.  Implement the common member form plus conditional Judge, Steward, Judge + Steward, and Veterinarian fields from the approved dictionary.

6.  Implement member self-service changes to all signup fields and classifications, preserve history, validate the resulting roles, and notify administrators.

7.  Pass cross-account, role-escalation, validation, audit, and membership-entitlement automated tests.

# 5. Release 2 - billing, manual payments, dashboard, and administration

Implementation status: Phase 1 (backend billing foundation) is complete — `subscriptions` and `payments` tables (migration `0011`, forward-only and not yet released, matching the `0009`/`0010` precedent), a rolling 12-month renewal calendar (`lib/payments/renewal.ts`), and idempotent webhook processing for every required Stripe event (`lib/payments/webhook-handlers.ts`, using the previously-scaffolded-but-unused `stripe_events` table). Phase 2 (real €80 Checkout Session creation in both modes, the pricing page, a basic dashboard billing status display, and redirect-callback cleanup) is also complete — `lib/payments/checkout.ts` creates the Stripe Customer and Checkout Session using inline `price_data` against two configured Products (`STRIPE_RECURRING_PRODUCT_ID`/`STRIPE_ONE_TIME_PRODUCT_ID`), never a pre-created Price ID; `app/(dashboard)/pricing/page.tsx` offers both the auto-renewal and one-time paths at the same flat fee; `app/api/stripe/checkout/route.ts` is now a stateless return-trip redirect with no database or Stripe access, since entitlement is granted only by the webhook. Phase 3a is also complete — `lib/payments/stripe.ts`'s `createMembershipPortalSession` creates an ownership-verified Stripe Billing Portal session scoped to the authenticated member's own `billing_accounts` row (payment-method updates, invoice history, and at-period-end cancellation only; it never creates a Stripe Customer, so bank-transfer/PayPal/cash/complimentary members are never forced into Stripe); `lib/payments/manual-payments.ts`'s `recordManualPayment` records a fixed €80/12-month PayPal, bank transfer, cash, or complimentary payment together with its membership extension and audit entry in one transaction, reachable only by administrators through `app/(dashboard)/admin/payments`. Phase 3b (item 11: renewal/expiration/grace notifications with delivery history) is also complete — `lib/notifications/renewal-notices.ts`'s daily `enqueueRenewalNotices` scan finds subscription-mode members 15 days from their scheduled renewal, non-auto-renewing members (one-time/manual/PayPal/bank/cash/complimentary, or a cancelled subscription) 30 days from their paid-through date, and members mid-grace or at grace end, enqueuing one deduplicated `notification_outbox` row per notice-cycle (a new `dedupe_key` unique column makes a re-run or a missed cron tick safe); `deliverNextRenewalNotice` sends each via the existing Mailchimp Transactional wrapper with the same lease/retry/dead-letter machinery as the account-delivery worker. `handleInvoicePaymentFailed` now sends a notice at the moment of failure and — a correctness fix, not just new behavior — only acts on the transition into grace, since Stripe's Smart Retries previously caused every retry attempt to silently reset the five-day grace window. The grace-period-end transition to `memberships.status = 'expired'` is implemented for the first time (previously nothing in the codebase ever set that status). Two new Cron routes (`/api/cron/renewal-notice-scan` daily, `/api/cron/renewal-notice-delivery` every five minutes) and an administrator-only `/admin/notifications` delivery-history view round this out. Not built in this phase, matching its deliberately narrow scope: member-facing notification history, opt-out/notification-preference controls (docs/02 §11's renewal/expiration/payment/account-standing categories are all mandatory, so nothing to opt out of yet), and any notice beyond the five implemented (mid-grace and grace-end were added on top of what docs/02 §5.1 names explicitly). Phase 4 (item 13, member dashboard, plus the well-specified slice of item 14) is also complete — `/dashboard` now gates on `requireAccountAccess('profile')` instead of `'member'`, so an expired or under-review member can reach their own status page (docs/02's "limited expired-account view"), and shows an auto-renew/manual/cancelling indicator derived from `lib/membership/entitlement.ts`'s `renewalMode()`; `/dashboard/payments` (`listOwnPaymentHistory`) shows each member their own payment summary (date, amount, friendly source label) with internal fields (administrator identity, external payment/reference IDs, admin reason) never selected; `/dashboard/profile` is now linked from the sidebar (item 13's "change requests" is realized as this edit affordance, not a member-visible history log, since docs/02 §7 keeps that history administrator-only). On the administrator side, `/admin/members` is the new canonical member-search hub (`admin/payments` and `admin/notifications` now link out from it instead of duplicating the search box), offering profile/roles-and-levels correction — `updateMemberProfile` now takes an optional `reason`, required and audited whenever the actor isn't the profile owner, reusing the same role-transition mechanism docs/07 §5-6 describe for level changes — and an inline audit-trail view via the previously-unused `listAuditHistory`. Phase 5a (suspend/reinstate, entitlement correction, admin-role granting, exports) is also complete — `lib/membership/status-actions.ts`'s `suspendMembership` denies access regardless of paid-through date, freezes `valid_until` so a reinstated member keeps their remaining term, and best-effort cancels an open Stripe subscription immediately (the DB suspension itself always commits first, independent of Stripe's availability; a duplicate suspend call with a still-open subscription retries the cancellation without a duplicate audit entry); `reinstateMembership` restores one of `active`/`grace`/`complimentary`/`canceled` without touching `valid_until`; `correctEntitlement` directly sets `valid_until` and/or `status` (excluding `'suspended'`, which stays exclusive to `suspendMembership`'s Stripe-safety-net path) for out-of-band corrections. `lib/membership/role-grants.ts`'s `grantApplicationRole`/`revokeApplicationRole` are Super-Admin-only (the first real use of `requireSuperAdmin`, previously unreachable in production) and block revoking the last active Super Admin under concurrent revocation, not just self-removal. `lib/membership/exports.ts` plus four new `/api/admin/export/*` routes provide CSV exports of the member directory and notification history (Administrator) and the payment ledger and audit log (Super Admin, since both are financial/sensitive). All four surface on an extended `/admin/members` hub and a new `/admin/exports` page. Phase 5b (item 14's final piece, Stripe reconciliation, docs/04 §9) is also complete — `lib/payments/reconciliation.ts`'s pure `computeReconciliationFindings` compares live Stripe data against local `subscriptions`/`billing_accounts` state for the four anomaly categories docs/04 §9 names: a locally-tracked subscription whose Stripe status has drifted (`status_conflict`); a Stripe subscription that's `active`/`trialing`/`past_due` (`lib/payments/pricing.ts`'s `OPEN_SUBSCRIPTION_STATUSES`) with no matching local row (`orphaned_subscription`); an open Stripe invoice with two or more failed payment attempts (`repeated_failure`); and a Stripe Customer with no matching `billing_accounts` row (`unlinked_customer`). `lib/payments/reconciliation-scan.ts`'s `runReconciliationScan` is the IO wrapper — it paginates the three Stripe list endpoints, then transactionally replaces the current `reconciliation_findings` snapshot and appends a `reconciliation_runs` heartbeat row; a failed run (e.g. a Stripe outage) leaves the last known-good findings snapshot in place rather than wiping it to a false "all clear," and errors propagate to the daily `/api/cron/reconciliation-scan` Cron route so a failure alerts the same way every other cron worker in this codebase does. The read-only, Administrator-tier `/admin/reconciliation` page (matching `/admin/notifications`'s tier, not the Super-Admin tier used for the payments/audit-log exports) surfaces the last run's status and the current findings, linking each finding with a resolvable member to `/admin/members` — remediation goes through the existing suspend/reinstate/correct-entitlement tools, not this page. All of item 14 is now complete, and Release 2 is **closed**. Item 15's "complete Stripe test-mode and manual-payment lifecycle testing before using live billing" is covered by this release's accumulated integration-test suite (193 tests against real PostgreSQL across every billing/membership/administration path, all exercising Stripe interactions through injected test clients); no separate manual pass against a live Stripe test-mode account has been run as part of this phase. Release 3 (migration and membership launch, docs/08 §6) is next.

8.  Create/use two required €80 annual Stripe Prices for new memberships: one recurring annual Price for auto-renewal and one non-recurring Price for the member-selectable one-time path. Retain historical Price IDs for valid imported subscriptions.

9.  Implement both required Stripe Checkout modes: subscription for auto-renewal and payment for one-time membership. Verify idempotent webhooks, project subscriptions/payments locally, and implement failed-payment behavior, cancel-at-period-end, and reconciliation.

10. Provide an ownership-verified Stripe Customer Portal for payment-method and permitted subscription changes.

11. Implement renewal preference/status and required/optional notification controls through Mailchimp Transactional, with delivery history.

12. Implement EUR manual cash, bank transfer, PayPal and complimentary-membership recording. Payment/adjustment, entitlement change, reason and audit entry commit together.

13. Build member dashboard: membership status, paid-through/renewal date, auto-renew status, portal access, payment history, permitted profile edits, security controls, professional information and change requests.

14. Build administrator tools: member search, profile correction, roles/levels, change-request review, manual payments, entitlement correction, suspension/reinstatement, audit, exports, notification history and Stripe reconciliation.

15. Complete Stripe test-mode and manual-payment lifecycle testing before using live billing.

# 6. Release 3 - migration and membership launch

Release 1 security follow-up: live canonical TOTP enrollment, login challenge, and password-reset challenge are implemented for database-granted Administrators and Super Admins. Ordinary members retain emailed reset OTP. Privileged reset has no email fallback or remembered-device bypass, revokes persisted sessions, and requires fresh sign-in. Recovery-authorized factor replacement, generic sensitive-action step-up, account-security management UI, broader notification/session-revocation integration, member remembered-device behavior, and production key deployment/UAT remain open release gates.

16. Export only IDOC users and relevant metadata from the WordPress Multisite network plus IDOC MemberPress memberships, subscriptions and transactions.

17. Import profiles, roles, membership state, manual payments, legacy IDs, Stripe Customer/Subscription IDs, and paid-through dates with deterministic mapping and exception reporting.

18. Pre-create account identities and send activation instructions; do not ask migrated members to register or repay.

19. Run a full staging rehearsal and reconcile member counts, classifications, entitlement, Stripe subscriptions, manual payments, duplicates and exceptions.

20. Obtain IDOC internal acceptance; freeze legacy IDOC membership changes; take final backups/exports; rerun the idempotent import; and switch the production webhook. Do not switch public routing or announce launch until Releases 4–6 meet their acceptance gates.

21. Monitor errors, webhooks, notifications and discrepancies through the approved stabilization period.

22. Retain the legacy IDOC interface as a runnable, read-only rollback target throughout stabilization. After complete-project public-launch acceptance, rollback closure, and archival backup, retire it and its jobs/webhooks. The other former multisite sites will already have been retired independently.

# 7. Release 4 - restricted CMS

- Page fields: title, slug, structured/rich body, summary, status, author, revision, publish/schedule dates, featured media, SEO title/description and audit metadata.

- Audiences: public plus a checklist of active member, Judge, Steward and Veterinarian. Each restricted CMS item must explicitly select either Match any selected audience (union) or Match all selected audiences (intersection). Administrators see all published content.

- Access is evaluated server-side from current membership and active professional roles. Restricted content must not leak through public caches, previews, feeds, sitemaps, APIs, or search indexing.

- Editorial workflow: draft, preview, review if adopted, publish, revise, unpublish/archive, and audit.

# 8. Release 5 - seminars

- Seminar data: title, description, presenter, dates/times/time zone, venue/online details, capacity, registration window, eligibility, prices, cancellation/refund policy and communications. Eligibility uses the same explicit Match any selected audience or Match all selected audiences setting as CMS.

- Registration: authenticated member or optional guest/public path, eligibility validation, concurrency-safe capacity, optional waitlist, consent fields, payment state, confirmation and attendance.

- Payments: application-created Stripe Checkout and approved manual methods. Seminar payments are classified separately and never alter membership entitlement.

- Operations: attendee lists/exports, reminders, cancellations, refunds, transfers if adopted, attendance and reconciliation.

# 9. Release 6 - news and blog

- News and blog article types with author, draft/published/scheduled state, publication date, featured media, categories/tags, SEO fields and revisions.

- Administrators receive authoring/publishing permissions; the president is an administrator.

- Articles are public by default when intended, with optional use of the same audience restriction system as CMS pages.

# 10. Cross-cutting acceptance gates

| **Gate**            | **Pass condition**                                                                                                                          |
|---------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| Architecture        | Production uses Vercel, Render PostgreSQL idoc schema with isolated Drizzle ledger/TLS, server-only credentials, Stripe and Mailchimp Transactional. |
| Authorization       | Cross-member reads/writes and client-driven privilege escalation fail; restricted content is not cached publicly.                           |
| Billing integrity   | Webhook replay cannot duplicate payment or entitlement; manual payment commits atomically; seminar billing cannot affect membership.        |
| Migration integrity | Every in-scope legacy record has a disposition; counts and financial/entitlement totals reconcile; unrelated multisite sites are unchanged. |
| Member experience   | Existing members activate access without repurchase; new members complete one conditional signup and one €80 payment path.                  |
| Operations          | Administrators can resolve normal cases without direct database edits and all sensitive changes are auditable.                              |
| Launch readiness    | Backups, rollback, monitoring, notification delivery, admin training, acceptance checklist and support procedure are complete.              |

## 10.1 Security architecture required before import

The starter must be hardened before production data is imported. The required trust chain is application authentication, explicit server-side authorization at every data-access boundary, authorized Render PostgreSQL access, and IDOC membership/role entitlement. Stripe follows a separate verified-webhook path and never serves as the authorization system.

- Every Server Action, Route Handler, API endpoint, background job, and private server-rendered read enforces ownership or administrator permissions server-side.

- Browsers never receive database/authentication/Stripe/Mailchimp Transactional secrets and never supply trusted active-subscription, membership, professional-level, or administrator state.

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

The required signup fields, permitted status values, rolling membership calendar, billing, self-service, notification, administrator, CMS, seminar and publishing rules are approved in document 02. Begin Release 1. Release 3 establishes migrated membership readiness only; the public IDOC launch occurs after Releases 4–6 and complete-project acceptance.
