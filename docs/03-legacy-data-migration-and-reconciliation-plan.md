**IDOC**

**Legacy Data Migration & Reconciliation Plan**

WordPress Multisite + MemberPress to Render PostgreSQL without forcing member re-enrollment

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.2                                            |
| **Date**             | 2 September 2026                              |

Working project document. Update this document when project decisions change.

# 1. Migration objective

Move the canonical membership information out of the existing IDOC WordPress/MemberPress implementation while preserving identity, membership status, professional classification, billing history references and recurring Stripe relationships.

IDOC already uses member-specific rolling expiration dates. The migration must preserve each member's current paid-through/expiration date exactly; it must not normalize members to a common annual expiration date or restart a 12-month term on import.

At import and cutover, derive access from that preserved date under docs/02: currently paid members are active; previously paid members within five calendar days after paid-through are in full-access grace; previously paid members beyond grace and accounts with no verified eligible payment are payment-only after authentication. Import must not manufacture a payment or extend a date merely to grant dashboard access.

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

10. Stabilization and retirement: retain an archival export/backup through the agreed stabilization period, then retire the legacy IDOC WordPress/MemberPress site after launch acceptance.

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

7. Record a migration_map row containing source IDs, target IDs, match method and confidence/review status. A successfully imported WordPress identity uses `legacy_type = wp_user` and `disposition = imported`; migrated-account activation requires that exact successful user mapping and cannot be satisfied by a mapping for another entity type.

# 6. Exception categories

| **Exception**                                           | **Default handling**                                                                     |
|---------------------------------------------------------|------------------------------------------------------------------------------------------|
| Duplicate email addresses                               | Hold for manual review; decide merge versus separate identity.                           |
| MemberPress says active, Stripe says canceled/ended     | Use paid-through and approved business rule; flag discrepancy.                           |
| Stripe active subscription with no clear WordPress user | Review Stripe customer metadata/email and legacy history; no automatic attachment.       |
| Manual active member with no recent transaction         | Require administrator validation or documented legacy rule.                              |
| Imported member with no confident Stripe match          | Retain the imported membership paid-through date and default the account to non-auto-renew; offer auto-renewal when renewal is due. |
| Imported member has current Stripe cancellation/pending renewal evidence | Preserve the effective billing state and paid-through date; do not create a second subscription. Map the current/pending renewal preference only from verified evidence. |
| Unknown judge/steward level value                       | Import original value to migration note; do not silently coerce.                         |
| Required approved profile or role field missing         | Preserve the source value where available, mark the record review_required, and do not invent a value. |
| Multiple Stripe subscriptions for one person            | Review whether duplicate, historical, or legitimate; avoid double entitlement extension. |

# 7. Account migration strategy

All known members should be represented in the target database before launch. Authentication accounts should be created/imported in advance so the member's first interaction is account access, not membership registration.

- The required default is to import and preserve every valid WordPress password hash that the application has verified it can safely support. This applies to the confirmed WordPress portable phpass and WordPress bcrypt formats described in section 11. Hash preservation is a migration requirement, not an optional convenience or a risk-based choice to discard supported credentials.

- Use the one-time secure activation/password-set flow only for accounts whose credential is missing, malformed, or in a format the verified importer cannot support. Report those accounts as explicit migration exceptions. A supported hash that fails verification for an entered password is an ordinary failed login; it must not be silently replaced or treated as an import exception.

- A supported password found in the breached-password corpus must not receive a normal authenticated session; require the standard secure password-reset flow. Do not use blanket activation as a substitute for the breach check.

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

The final migration must avoid destructive changes to existing Stripe subscriptions. Preserve an archival legacy export/backup during the stabilization period so application routing can be reverted if necessary while the new database remains preserved for diagnosis. Any post-cutover writes that affect billing must be separately audited so they can be reconciled if rollback occurs.

## Credential-bearing export retention

- Keep the original export containing WordPress `user_pass` hashes encrypted in approved, access-controlled migration storage. Limit access to the migration operators who need it; never copy it into email, tickets, logs, analytics, or reconciliation reports.
- Retain that credential-bearing export only through import reconciliation and the 30-calendar-day production rollback window, measured from cutover. At the end of that window, securely delete the export and its working copies. If an encrypted backup replica cannot be selectively deleted, use an archive-specific encryption key and destroy that key at the deadline so the replica is no longer recoverable.
- Any archive retained after the rollback window must exclude `user_pass` entirely and must also omit `user_activation_key`, reset tokens, sessions, cookies, and other authentication artifacts. Do not keep a masked or partial password-hash column.
- The imported credential in IDOC's authentication store is separate from the source export: retain a supported legacy hash only until the member successfully signs in and the current IDOC hash is durably written, or until the member completes a secure password reset. Clear the legacy hash atomically at that point, as required in section 11.

## Imported-account activation foundation

The later repeatable importer may create an identity in `migrated_pending` state and issue a `migration_activation` token for that existing user. Activation verifies the purpose-scoped, expiring digest, establishes a password, verifies access, and changes only account authentication state. It requires the imported profile, at least one professional role, membership entitlement, and migration mapping to exist; a missing foundation produces auditable reconciliation evidence and leaves the identity pending. It does not insert or update the imported profile, professional-role history, membership term/status, billing account, Stripe identifiers, or migration map. A successfully delivered replacement invalidates earlier unconsumed activation links; delivery failure preserves the earlier usable link. Successful use consumes all outstanding account tokens for the identity.

# 10. Scope exclusion: News, Blog and Seminar content

The legacy importer covers **members, memberships, payments/transactions and subscriptions only** (sections 2 to 9). News, Blog and Seminar/Course content is not imported: it has already been created in the new site, and the former one-time content import script and its test were removed. Do not add content import to the member importer. Legacy `wp-content/uploads` links are handled by the documents committed under `public/documents/`.

# 11. Migrated WordPress credentials and password security

The importer must preserve existing member credentials wherever their WordPress password hash is supported and can be verified safely. A migrated member with a supported hash should be able to sign in with their existing email and password without re-registering or repeating profile setup.

## Import and storage requirements

- Import the WordPress `user_pass` hash exactly as exported into the application's dedicated credential representation. Preserve the format/version needed to select the verifier. Do not place it in a profile field or overwrite it with a fabricated credential.
- The supplied users snapshot contains two formats: WordPress portable phpass hashes (`$P$...`) and WordPress bcrypt hashes using the `$wp$2y$` prefix. The importer must validate these formats against the actual source WordPress implementation and must recount the final cutover export; unsupported or malformed hashes go to an exception report and use the one-time secure activation/password-set flow in section 7.
- Do not import `user_activation_key`, WordPress reset/activation tokens, sessions, cookies, or other authentication artifacts.
- Treat password hashes as sensitive credential material. Restrict access, keep them out of logs, analytics, error reports, and reconciliation output, and delete temporary source copies according to the migration retention policy. Never attempt to recover or crack plaintext passwords.

## First-login verification and upgrade

1. Verify `$P$` hashes with a tested WordPress-compatible portable phpass verifier and `$wp$2y$` hashes with a verifier tested against the actual WordPress bcrypt implementation/version. Do not assume prefix manipulation alone is sufficient.
2. Apply existing login rate limits and the normal account-state, email-verification, MFA, and authorization gates. Successful password verification must not bypass any of them. Use enumeration-safe outward errors.
3. After successful verification, check the entered password against the Have I Been Pwned Pwned Passwords corpus using its range-query protocol. Compute the SHA-1 digest locally, send only its first five hexadecimal characters over HTTPS, and compare returned suffixes locally. Never transmit the plaintext or full digest, and never log or persist either value or the returned suffixes.
4. If the password is reported as breached, do not create a normal authenticated session. Require a password reset through the existing secure recovery flow before normal access, then apply the regular email-verification and MFA requirements.
5. If the breach service is unavailable or times out, do not lock all migrated members out because of the outage. Complete normal authentication and credential upgrade, record only that the breach check is pending, and retry without retaining the plaintext. Monitor service failures without credentials or unnecessary personal data. A no-match means only that the password was not found in that corpus; it does not prove that it is strong or unique.
6. For a successful, non-breached login, atomically replace the imported hash with the current IDOC password hash (Argon2id per the authentication requirements). Clear the legacy hash only after the new hash is durably saved. Handle concurrent login/upgrade attempts so an older value cannot overwrite the new credential.
7. For an unsupported or malformed hash, offer the one-time secure activation/password-set flow in section 7. A password that fails verification against a supported hash is an ordinary failed login. Do not disclose account existence on public login or recovery surfaces.

## Password policy for migrated accounts

- New accounts, password changes, and password resets must continue to enforce the current IDOC password policy and reject passwords found in the breached-password corpus. The authoritative authentication requirements define the numeric minimum; this migration plan does not set a different threshold.
- Do not force a member to change a successfully verified legacy password solely because it is shorter than the current minimum or fails a composition rule. Upgrade its hash after successful verification and let the member keep using it unless there is evidence of compromise, such as a confirmed breach-corpus match, or another separately documented security trigger.
- Password hashes cannot reveal password length or composition. Do not infer compliance from hash prefix, hash length, algorithm, salt, or age, and do not claim that a whole-population percentage is known from the export.
- If IDOC wants an aggregate estimate after its numeric minimum is confirmed, the application may measure length transiently when members successfully log in. It must not store or log passwords. Retain only aggregate counts and policy version, and label the result as a sample of successful logins, not a census of all imported accounts. Do not force a reset solely from a partial sample unless that policy is explicitly approved after review.
- Do not impose periodic password rotation absent evidence of compromise or another documented risk.

## Required pre-cutover verification

- Test valid and invalid phpass and WordPress bcrypt hashes generated by, or verified against, the source WordPress implementation.
- Test successful legacy verification, atomic upgrade, removal of the old hash only after durable persistence, and concurrent upgrades.
- Test wrong passwords, malformed/unsupported formats, reset fallback, enumeration-safe responses, rate limits, and all required email-verification/MFA/account-state gates.
- Test that breach-range requests send only the permitted hash prefix, compare suffixes locally, and never log or persist the plaintext, full digest, or returned suffixes.
- Test that a breach match blocks normal login pending reset, a non-match follows normal authentication, and service unavailability does not create a system-wide lockout.
- Test new-password and password-change policy enforcement, including rejection of passwords found in the breach corpus.
- Keep reconciliation limited to aggregate counts by hash format and unsupported/malformed status. Never include hash values, plaintext passwords, or unnecessary personal data.
- Complete a repeatable staging rehearsal against a fresh export, verify all reconciliation exceptions, and document rollback/recovery before cutover.

## Member communications and billing launch hold

The server-only `DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING` setting defaults to blocking. Only exact `false` releases member communications and live application billing; validated Stripe test-mode mutations remain available. Configure staging and Production independently. Follow [the complete launch-hold runbook](27-member-communications-and-billing-launch-hold.md) for coverage, terminal queue handling, webhook reconciliation, pre-launch verification, release and emergency re-hold.

# 12. Temporary Super Admin legacy import tool

The repeatable importer is delivered as a **temporary Super Admin tool** at `/admin/operations/legacy-import`, built in stages. It exists so one operator can run the dry run, the staging import, the production import and the final delta import without a developer terminal. Delete `app/(dashboard)/admin/operations/legacy-import`, `lib/legacy-import`, its navigation entry and the `serverActions.bodySizeLimit` setting in `next.config.ts` once the migration has been stable for the agreed period after launch. The stored legacy password hash, supported-hash first-login verification and the onboarding path for incomplete profiles (section 11) are product behavior, not part of this temporary tool, and stay until every migrated member has signed in.

**Source files.** Two MySQL dump files exported from the legacy multisite: the network users tables (`psspaceusers`, `psspaceusermeta`) and the site 58 MemberPress tables (`psspace58_mepr_transactions`, `psspace58_mepr_subscriptions`). The dump files hold credential-bearing data and stay in approved migration storage (see Credential-bearing export retention); the tool reads an uploaded file in memory and never stores it.

**Mapping rules decided with the operator (2026-10).**

- Membership product to roles: 2042 Judge, 2053 Steward, 2787 Judge & Steward, 3038 Veterinarian. All four are one ordinary annual membership; the product only decides which professional roles are created. A product that disagrees with the judge/steward details on the profile is flagged `product_profile_mismatch`, never guessed.
- Judge statuses map to the canonical list; legacy "National Grand Prix Judge" maps to "National Senior Officials / Candidates from EEFs education system FEI". Steward Level 3 maps to "FEI Dressage Steward Level 3/4". Any other unmapped value is flagged.
- A blank technical-delegate answer becomes No. A blank address country is filled from the national federation country and noted in the report; street, city and postal code are never invented.
- IDOC region slugs map one-to-one to the canonical regions; a blank region is a missing required field.
- Paid-through is the latest expiry date of that member's completed payments; failed and pending payments never count. A completed payment with no expiry date is flagged.
- The newest `active` subscription is the live one; older cancelled or pending subscriptions are history only and never create a second subscription. Two active subscriptions, or an active one that is not the newest, are flagged for review.
- **Cleanup rules (decided 2026-10-17, because the old site's member list was bulk-loaded years ago and many people never signed in or paid):** a member who has been expired for a year or more (paid-through on or before the same calendar date one year earlier), and a member with no completed payment on record, are **not imported** and are left out of every other figure in the report; they can simply sign up again. This supersedes the payment-only treatment of those two groups described in section 1. Each group is still listed on its own so the operator can see who was removed. Duplicate-email, payment-reference and every other check are evaluated only among the members who remain. Payment or subscription history whose user has no account record belongs to a person who was deliberately deleted (not a member): nothing is imported for them, and the report lists them as already handled, noting how many still show an active MemberPress subscription so the operator can check Stripe.
- Members whose profile is missing required fields are imported and activate into the existing onboarding flow, which requires the missing fields before the account becomes fully active. Users flagged deleted/spam, with an invalid email, or sharing an email with another legacy user are held and not imported. Payment or subscription records for users with no account row are listed and not imported.

**Stage 1 (implemented): dry run.** The page accepts the two files. The browser first trims each file to the CREATE TABLE and INSERT statements of the four tables the importer needs (found by name ending, whatever the prefix: `…users`, `…usermeta`, `…_mepr_transactions`, `…_mepr_subscriptions`; when several tables match, the one with the most rows is used and the report lists which tables were read and which were ignored), so raw dump files can be uploaded unprepared, and everything else in the dump never leaves the operator's computer and the upload stays under the 4 MB request limit; the server then reads what it receives in memory, applies the rules and shows aggregate counts. Problems are split into **Expected** (the plan already has a remedy, for example missing profile fields are completed in onboarding) and **Needs a decision** (a person must look at it). Every group has a download icon that produces a CSV with one row per person (legacy user ID, name, email, product, membership dates, subscription and Stripe IDs, missing fields, issues). The CSVs are built in the Super Admin's browser from the response and are never stored by the server. The report and the CSVs never include password hashes or payment references. It writes only one audit row (file checksums and counts), stores nothing and sends no email. Controls: Super Admin, CSRF, fresh TOTP step-up, and the server-only switch `LEGACY_IMPORT_ENABLED=true` (off by default).

**Stripe comparison (implemented in the dry run).** When the server-only variable `LEGACY_STRIPE_SECRET_KEY` is set to a live-mode restricted key with read-only access to Customers, Subscriptions, Invoices, Charges and PaymentIntents, the dry run also compares the plan with live Stripe using list calls only and adds a "Compared with live Stripe" section. It reports: legacy active subscriptions missing in Stripe, active in the legacy data but cancelled in Stripe, still billing in Stripe but not active in the legacy data, subscription/customer mismatches, stored customer IDs missing in Stripe, members whose Stripe payments are not found, and live Stripe subscriptions that belong to people removed by the cleanup rules or to no legacy record. The report states exactly what live Stripe holds for the subscriptions of people who are not imported (deleted users and members removed by the cleanup rules): how many are still billing, cancelled or ended, or not found in Stripe. Any that are still billing are listed under "Needs a decision" and must be cancelled in Stripe, in a separately confirmed step, before go-live (if none are billing, nothing needs cancelling). The variable is set only for the staging Preview environment; the key is never the application's own Stripe key, is never used for writes, and the report never includes card data. Without the key the section says nothing was compared. Charges are read in parallel month windows from the first legacy Stripe payment date; if any list is still cut short (time or size cap) the report names the checks that were not run, so an empty result is never presented as "all clear". The comparison checks existence and status only; it does not compare payment amounts or dates. Duplicate Stripe payment references: an identical row repeated on the same member (same reference, amount and outcome, usually a duplicated MemberPress row) is imported once and listed under Expected; the same reference on the same member with a different amount or outcome, and the same reference on different members, need an operator decision. The report opens with one banner stating whether anything needs the operator's decision or manual fix; only groups under "Needs a decision" (and review groups in the Stripe comparison) count, and everything under Expected is handled by the import itself.

**Stripe environments.** Staging's own Stripe credentials (`STRIPE_SECRET_KEY`) point to the Stripe test-mode sandbox, while the legacy data holds **live-mode** customer and subscription IDs, which a sandbox cannot resolve. The dry run therefore never uses the application's Stripe key: its read-only comparison uses only the separate live restricted key `LEGACY_STRIPE_SECRET_KEY` (list calls only, set for the staging Preview environment only, never Production). A staging import would store live IDs that the staging sandbox cannot find; before the staging import stage is built, decide whether staging imports omit the Stripe IDs or keep them and tolerate lookup failures.

**Later stages (not yet built).** The staging/production import action (one transaction per run, idempotent through `migration_map`, bound to the checksum of the file that was reviewed, requiring a recent verified backup), supported-hash first-login verification, and the confirmed cancellation of live Stripe subscriptions that belong to removed people (the read-only comparison itself already runs in the dry run).
