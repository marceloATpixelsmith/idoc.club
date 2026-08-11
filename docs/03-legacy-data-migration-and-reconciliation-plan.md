**IDOC**

**Legacy Data Migration & Reconciliation Plan**

WordPress Multisite + MemberPress to Render PostgreSQL without forcing member re-enrollment

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.1                                            |
| **Date**             | 11 August 2026                                 |

Working project document. Update this document when project decisions change.

# 1. Migration objective

Move the canonical membership information out of the existing IDOC WordPress/MemberPress implementation while preserving identity, membership status, professional classification, billing history references and recurring Stripe relationships.

IDOC already uses member-specific rolling expiration dates. The migration must preserve each member's current paid-through/expiration date exactly; it must not normalize members to a common annual expiration date or restart a 12-month term on import.

# 2. Source data inventory

| **Source**                   | **Extract**                                                                                                       |
|------------------------------|-------------------------------------------------------------------------------------------------------------------|
| WordPress users              | User ID, email, display/name fields, registration date, relevant usermeta.                                        |
| MemberPress memberships      | Membership/product assignment, status, dates and MemberPress identifiers.                                         |
| MemberPress subscriptions    | Subscription IDs, gateway, external subscription/customer references, status and recurring metadata.              |
| MemberPress transactions     | Payment dates, amounts, gateway, transaction IDs, subscription links and membership links.                        |
| Custom/member profile fields | Judge/steward/vet classification, levels, contact information and any IDOC-specific attributes.                   |
| Stripe production account    | Customers, subscriptions, prices, invoices and status used to independently verify MemberPress Stripe references. |

# 3. Migration phases

1. Discovery export: capture schema, field names, custom MemberPress data and representative records.

2. Transformation specification: document exact source-to-target mappings and status rules.

3. Dry-run import: import to staging with no production writes to Stripe.

4. Automated reconciliation: match Stripe-linked members against Stripe's production objects using read-only retrieval.

5. Exception review: resolve duplicate emails, missing Stripe IDs, inconsistent status, manual payment ambiguity and invalid professional levels.

6. Migration rehearsal: repeat from a fresh export and measure deterministic results.

7. Pre-cutover freeze: establish the period during which legacy membership changes are controlled or recorded for delta migration.

8. Final export and delta import: apply only changes after the rehearsal snapshot.

9. Cutover reconciliation: compare legacy counts, new counts, Stripe active subscriptions, expiration distributions and exception list.

10. Legacy read-only period: keep the old system available to administrators as a reference until acceptance criteria are met.

# 4. Source-to-target mapping worksheet

| **Legacy source**        | **Legacy field/example** | **Target**                             | **Rule**                                                       |
|--------------------------|--------------------------|----------------------------------------|----------------------------------------------------------------|
| wp_users                 | ID                       | profiles.legacy_wp_user_id             | Direct copy; unique.                                           |
| wp_users                 | user_email               | profiles.email + auth identity         | Normalize case/whitespace; duplicate check.                    |
| MemberPress membership   | membership/product       | memberships + professional roles       | Use approved mapping, not product name inference if ambiguous. |
| MemberPress subscription | gateway                  | subscriptions.provider                 | Map Stripe/PayPal/etc.                                         |
| MemberPress subscription | subscr_id                | subscriptions.external_subscription_id | Preserve exact value.                                          |
| MemberPress transaction  | trans_num                | payments.external_payment_id           | Preserve exact value.                                          |
| Custom meta              | judge/steward level      | professional_roles.level_code          | Validate against approved allowed values.                      |
| WordPress/MemberPress profile data | first/last name and complete address | profiles | Map each approved common field separately; do not collapse the address into one string. |
| Custom/member profile data | National Federation, IDOC Region and FEI ID | professional_roles | Required for Judge, Steward, and Judge + Steward; normalize federation through the canonical country list and validate Region. |
| Custom/member profile data | Judge status and Technical Delegate | Judge professional_roles record | Validate against the approved Judge values; unknown values go to review. |
| Custom/member profile data | Steward status | Steward professional_roles record | Validate against the approved Steward values; unknown values go to review. |

# 5. Matching algorithm for Stripe-linked members

1. Prefer an explicit Stripe Subscription ID stored by MemberPress.

2. Retrieve the subscription from Stripe and identify its Stripe Customer ID.

3. Match to the WordPress/MemberPress member by the legacy record containing that subscription reference.

4. Use email only as supporting evidence, not as the sole authority when explicit IDs exist.

5. If a subscription exists in Stripe but the associated legacy member is missing or ambiguous, create an exception; do not guess.

6. Store the verified Stripe Customer and Subscription IDs in the new database.

7. Record a migration_map row containing source IDs, target IDs, match method and confidence/review status.

# 6. Exception categories

| **Exception**                                           | **Default handling**                                                                     |
|---------------------------------------------------------|------------------------------------------------------------------------------------------|
| Duplicate email addresses                               | Hold for manual review; decide merge versus separate identity.                           |
| MemberPress says active, Stripe says canceled/ended     | Use paid-through and approved business rule; flag discrepancy.                           |
| Stripe active subscription with no clear WordPress user | Review Stripe customer metadata/email and legacy history; no automatic attachment.       |
| Manual active member with no recent transaction         | Require administrator validation or documented legacy rule.                              |
| Unknown judge/steward level value                       | Import original value to migration note; do not silently coerce.                         |
| Required approved profile or role field missing         | Preserve the source value where available, mark the record review_required, and do not invent a value. |
| Multiple Stripe subscriptions for one person            | Review whether duplicate, historical, or legitimate; avoid double entitlement extension. |

# 7. Account migration strategy

All known members should be represented in the target database before launch. Authentication accounts should be created/imported in advance so the member's first interaction is account access, not membership registration.

- If compatible password hashes can be safely migrated using a supported path for the application's authentication system, this may reduce friction, but it must be validated against the actual WordPress password hash format and the application's supported credential-import mechanism.

- If password migration is not supported or not worth the risk, create the auth identities and require a one-time secure password-set/magic-link activation.

- Do not email activation links until the target data and membership entitlement for that person are already present.

- Do not disclose whether arbitrary emails exist in the membership system on public recovery/activation forms.

# 8. Reconciliation report

| **Metric**                     | **Required result**                                                  |
|--------------------------------|----------------------------------------------------------------------|
| Total legacy users in scope    | Known and documented.                                                |
| Active legacy memberships      | Count matches approved target active/grace/complimentary population. |
| Stripe subscription references | Every reference verified, exceptioned or explicitly excluded.        |
| Active Stripe subscriptions    | No unexplained active production subscription left unassociated.     |
| Manual-pay active members      | Every active record has a defensible validity date/source.           |
| Duplicate identities           | Zero unresolved at launch unless explicitly accepted.                |
| Professional roles/levels      | All values valid or placed in review.                                |
| Migration failures             | Zero silent failures; every failed row listed with reason.           |

# 9. Rollback rule

The final migration must avoid destructive changes to existing Stripe subscriptions and avoid deleting the WordPress source during the initial production period. This makes application rollback possible: DNS/application routing can be reverted while the new database remains preserved for diagnosis. Any post-cutover writes that affect billing must be separately audited so they can be reconciled if rollback occurs.
