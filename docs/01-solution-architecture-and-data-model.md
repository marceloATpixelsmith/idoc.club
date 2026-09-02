**IDOC**

**Solution Architecture & Data Model**

Target design for IDOC membership, billing, authentication and administration

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.2                                            |
| **Date**             | 2 September 2026                              |

Working project document. Update this document when project decisions change.

# 1. Architecture principles

- Authentication answers who the person is.

- Authorization answers what that authenticated person may do.

- Membership answers whether the person currently has IDOC membership entitlement.

- Professional classification answers what kind of official the member is and at which level.

- Billing records how membership was paid and, when applicable, links to Stripe.

- Stripe is a billing system and event source; it is not the sole source of membership authorization.

- All privileged writes are executed server-side and validated against administrator permissions.

# 2. Target system context

| **Component**                            | **Responsibility**                                                                                                                                           |
|------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Next.js application on Vercel            | Public UI, member portal, admin portal, server actions/routes, Stripe webhook endpoint.                                                                      |
| Application authentication               | Member/admin authentication and account lifecycle implemented by the Next.js application and backed by user records in the idoc schema on Render PostgreSQL. |
| Render PostgreSQL                        | Canonical membership, profile, professional classification, payment and audit data in the dedicated idoc schema of the shared Render PostgreSQL database.    |
| Server-side data access layer            | All application database access remains server-side and enforces authenticated-user ownership and administrator permissions before querying the idoc schema. |
| Stripe                                   | New checkout, existing subscription billing, invoices, payment methods, customer portal and webhook events.                                                  |
| Legacy WordPress Multisite + MemberPress | Migration source before cutover; preserved as an archival backup/export during stabilization, then retired after launch acceptance.                               |

# 3. Logical data model

Release 1 implements these concepts in the `idoc` schema. Authentication users now have a one-to-one profile, time-bounded professional-role rows, independent membership-entitlement rows, server-managed application-role grants, append-only profile history and audit rows, an administrator-notification outbox, hashed email-verification tokens, migration traceability, member-owned billing-account linkage, and Stripe event IDs reserved for later idempotent billing processing. Legacy starter team tables remain temporarily for compatibility with unrelated starter billing code; IDOC registration, onboarding, dashboard, and authorization neither create nor depend on them.

| **Entity**             | **Purpose**                                                                        | **Important fields**                                                                      |
|------------------------|------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| profiles               | One application profile per authenticated person.                                  | id, auth_user_id, email, first_name, last_name, address_1, address_2, city, state_province, zip, country_code, legacy_wp_user_id |
| memberships            | Canonical IDOC entitlement record.                                                 | id, profile_id, status, start_at, valid_until, membership_type, source, notes             |
| professional_roles     | Judge/steward/vet classifications and status history.                              | profile_id, role_type, official_statuses, national_federation_country_code, idoc_region, fei_id, is_technical_delegate, effective_from, effective_to, verified_by |
| billing_accounts       | Links a member to external billing identities.                                     | profile_id, provider, external_customer_id                                                |
| subscriptions          | Tracks recurring subscription references without owning the external subscription. | profile_id, provider, external_subscription_id, status, current_period_end, price_id      |
| renewal_preferences    | Tracks member-controlled automatic-renewal intent and any future-effective transition. | profile_id, current_mode, pending_mode, effective_on, external_schedule_id, updated_at   |
| payments               | Ledger-like payment/renewal evidence for Stripe and manual channels.               | profile_id, provider, amount, currency, paid_at, external_payment_id, method, recorded_by |
| membership_adjustments | Manual grants/extensions/suspensions with reasons.                                 | profile_id, action, effective_at, reason, actor_id                                        |
| audit_log              | Immutable administrative/event history.                                            | actor_id, action, entity_type, entity_id, before_json, after_json, created_at             |
| migration_map          | Traceability from legacy IDs to new IDs and migration status.                      | legacy_type, legacy_id, new_entity_id, disposition, confidence, reviewed_by               |

# 4. Recommended membership status model

| **Status**      | **Meaning**                                                                  | **Member access**                         |
|-----------------|------------------------------------------------------------------------------|-------------------------------------------|
| active          | Entitlement is currently valid.                                              | Allowed                                   |
| grace           | Five calendar days after a previously paid term fails to renew or expires.   | Full member access with notice            |
| expired         | Grace ended without eligible payment.                                       | Payment gate and logout only              |
| canceled        | Will not renew or was manually canceled; access depends on valid_until.      | Until valid_until                         |
| suspended       | Administrative suspension regardless of paid-through date.                   | Denied                                    |
| complimentary   | Active membership granted without payment.                                   | Allowed                                   |
| review_required | Migration or payment ambiguity requires administrator review.                | Configurable; default deny until approved |

# 5. Professional classification model

Use role records rather than mutually exclusive columns so a combined Judge + Steward member is represented naturally as two active professional roles.

The approved labels, required fields, enumerated IDOC Regions, Judge statuses, and Steward statuses are governed by [02 Membership and Payment Business Rules](02-membership-and-payment-business-rules.md#11-approved-signup-field-dictionary). Store countries and National Federations as canonical country codes with localized display labels. Conditional fields must be validated server-side against the selected active role or roles; hiding a field in the browser is not validation.

| **Example member** | **Role records**                               |
|--------------------|------------------------------------------------|
| Judge only         | Judge / Level X                                |
| Steward only       | Steward / Level Y                              |
| Judge + Steward    | Judge / Level X AND Steward / Level Y          |
| Veterinarian       | Veterinarian / optional certification metadata |

# 6. Authorization model

| **Actor**                | **Permitted capabilities**                                                                                                               |
|--------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| Anonymous                | Public pages; no membership or private member data.                                                                                      |
| Account holder — never paid/post-grace expired | Membership-payment gate and logout only; no dashboard/member data reads or mutations.                                          |
| Paid/grace Member        | Read own profile, membership, professional role, payment summary and Stripe portal link; update explicitly allowed own-profile fields.   |
| Administrator            | Full application administration: member records, payments, entitlements, roles, content, seminars, publishing and audit access.          |
| Super Admin              | All Administrator capabilities plus restricted application settings and functions reserved for the project owner.                         |

# 7. Data integrity constraints

- Normalized email should be unique for active authentication identities, with exceptions explicitly reviewed before import.

- Stripe Customer IDs and Subscription IDs must be unique when present.

- Every administrator action and every member-initiated profile/classification change requires immutable history. Administrator actions include actor, timestamp, reason, and before/after values where applicable.

- A payment record must never directly overwrite professional classification.

- Client-submitted membership status, role, level, amount, Stripe identifiers or administrator flags are never trusted without server-side authorization.

- Authentication alone never authorizes dashboard or member-site access. Every member page, action, route, and data-access boundary derives current paid/grace entitlement server-side. Navigation hiding is not an access control.

- Migration records must retain the legacy primary identifiers needed to trace every imported value back to WordPress/MemberPress.

# 8. Suggested deployment environments

| **Environment**   | **Purpose**                        | **Data**                                                                                                                                                                                                             |
|-------------------|------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Local/development | Feature development.               | Synthetic data only.                                                                                                                                                                                                 |
| Vercel Preview    | Pull-request testing.              | Dedicated non-production Render PostgreSQL database or isolated non-production schema, with an isolated Drizzle migration ledger and Stripe test mode. Preview deployments must not migrate the production database. |
| Staging           | Migration rehearsal and UAT.       | Sanitized copy or controlled production-derived export; Stripe test references unless explicitly isolated.                                                                                                           |
| Production        | Live idoc.club membership service. | Shared production Render PostgreSQL database using the dedicated idoc schema and idoc.\_\_drizzle_migrations ledger, plus the existing production Stripe account. Connections require TLS/SSL.                       |

# 9. Architecture decision: do not normalize legacy Stripe Price IDs during cutover

Legacy subscriptions may remain on their existing Stripe Product and Price objects. New enrollments use one canonical IDOC Annual Membership Product with recurring and non-recurring €80 Price configurations beneath it. Both billing modes and all valid legacy Prices map to the same IDOC membership entitlement. Price normalization, if ever required, should be a separate billing project after the migration is stable.

## Release 1 account-token and session additions

Password recovery and migrated-member activation share a purpose-scoped account-token table. Only SHA-256 token digests are persisted; tokens expire, are claimed atomically once, and all outstanding account tokens are consumed after successful password establishment. `users.account_state` distinguishes unverified, onboarding, active, suspended, migrated-pending, and deleted identities, while application roles continue to distinguish Administrator and Super Admin. First-profile creation locks the onboarding identity and commits profile, role, history, audit, and the transition to active in one transaction. `users.session_version` is embedded in signed sessions and incremented by password reset so previously issued sessions cease to authenticate. Imported profiles, roles, memberships, billing links, and migration mappings are validated but not rewritten by activation.

The notification outbox records attempt count, last-attempt time, a non-sensitive error code, and successful delivery time. Profile data, active-role replacement, immutable history, audit evidence, and creation of the administrator notification job remain one database transaction.

## Release 1 durable anonymous account delivery

Password-reset and migrated-activation requests use purpose-separated, privacy-hashed database rate-limit buckets. Eligible requests atomically persist a token digest and an encrypted delivery payload in `account_delivery_outbox`; the encryption key remains server-only and each row records its key version and stable message identity. A protected Vercel Cron route runs every five minutes and processes at most 20 records. Workers claim rows with PostgreSQL `FOR UPDATE SKIP LOCKED`, owner leases, bounded exponential backoff, and a six-attempt dead-letter boundary. Claiming and the immediate pre-delivery check require a matching, unconsumed, unexpired token for the same user and purpose; permanent ineligibility is terminalized with only a safe reason classification before payload decryption or Mailchimp delivery. A replacement supersedes earlier usable tokens only after its delivery is recorded. Administrator profile-change notifications use the same lease and retry principles in their dedicated outbox.
