**IDOC**

**Solution Architecture & Data Model**

Target design for IDOC membership, billing, authentication and administration

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.1                                            |
| **Date**             | 11 August 2026                                 |

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
| Legacy WordPress Multisite + MemberPress | Migration source only after cutover; retained temporarily as a read-only reference/rollback source.                                                          |

# 3. Logical data model

| **Entity**             | **Purpose**                                                                        | **Important fields**                                                                      |
|------------------------|------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| profiles               | One application profile per authenticated person.                                  | id, auth_user_id, email, first_name, last_name, address_1, address_2, city, state_province, zip, country_code, legacy_wp_user_id |
| memberships            | Canonical IDOC entitlement record.                                                 | id, profile_id, status, start_at, valid_until, membership_type, source, notes             |
| professional_roles     | Judge/steward/vet classifications and status history.                              | profile_id, role_type, official_status, national_federation_country_code, idoc_region, fei_id, is_technical_delegate, effective_from, effective_to, verified_by |
| billing_accounts       | Links a member to external billing identities.                                     | profile_id, provider, external_customer_id                                                |
| subscriptions          | Tracks recurring subscription references without owning the external subscription. | profile_id, provider, external_subscription_id, status, current_period_end, price_id      |
| payments               | Ledger-like payment/renewal evidence for Stripe and manual channels.               | profile_id, provider, amount, currency, paid_at, external_payment_id, method, recorded_by |
| membership_adjustments | Manual grants/extensions/suspensions with reasons.                                 | profile_id, action, effective_at, reason, actor_id                                        |
| audit_log              | Immutable administrative/event history.                                            | actor_id, action, entity_type, entity_id, before_json, after_json, created_at             |
| migration_map          | Traceability from legacy IDs to new IDs and migration status.                      | legacy_type, legacy_id, new_entity_id, disposition, confidence, reviewed_by               |

# 4. Recommended membership status model

| **Status**      | **Meaning**                                                                  | **Member access**                         |
|-----------------|------------------------------------------------------------------------------|-------------------------------------------|
| active          | Entitlement is currently valid.                                              | Allowed                                   |
| grace           | Temporary grace period after billing issue or pending manual reconciliation. | Allowed, optionally with notice           |
| expired         | Validity period ended.                                                       | Denied                                    |
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
| Member                   | Read own profile, membership, professional role, payment summary and Stripe portal link; update explicitly allowed own-profile fields.   |
| Membership administrator | Search members, correct profile data, record manual payment, extend membership, update professional role/level, place records in review. |
| Billing administrator    | Reconcile Stripe billing and view payment/subscription detail; no unrestricted role escalation.                                          |
| System administrator     | Full application administration, security/configuration operations and migration tools.                                                  |

# 7. Data integrity constraints

- Normalized email should be unique for active authentication identities, with exceptions explicitly reviewed before import.

- Stripe Customer IDs and Subscription IDs must be unique when present.

- Every administrative membership change requires actor, timestamp and reason.

- A payment record must never directly overwrite professional classification.

- Client-submitted membership status, role, level, amount, Stripe identifiers or administrator flags are never trusted without server-side authorization.

- Migration records must retain the legacy primary identifiers needed to trace every imported value back to WordPress/MemberPress.

# 8. Suggested deployment environments

| **Environment**   | **Purpose**                        | **Data**                                                                                                                                                                                                             |
|-------------------|------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Local/development | Feature development.               | Synthetic data only.                                                                                                                                                                                                 |
| Vercel Preview    | Pull-request testing.              | Dedicated non-production Render PostgreSQL database or isolated non-production schema, with an isolated Drizzle migration ledger and Stripe test mode. Preview deployments must not migrate the production database. |
| Staging           | Migration rehearsal and UAT.       | Sanitized copy or controlled production-derived export; Stripe test references unless explicitly isolated.                                                                                                           |
| Production        | Live idoc.club membership service. | Shared production Render PostgreSQL database using the dedicated idoc schema and idoc.\_\_drizzle_migrations ledger, plus the existing production Stripe account. Connections require TLS/SSL.                       |

# 9. Architecture decision: do not normalize legacy Stripe Price IDs during cutover

Legacy subscriptions may remain on their existing Stripe Price objects. New enrollments can use a canonical current €80/year Price. Both can map to the same IDOC membership entitlement. Price normalization, if ever required, should be a separate billing project after the migration is stable.
