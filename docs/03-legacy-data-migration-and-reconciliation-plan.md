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

# 10. News/Blog/Seminar content migration

Separately from member/billing migration above, `scripts/data-import/legacy-idoc-club-content-import.sql` is a one-time, hand-run data import of the legacy site's public content into the tables `docs/01-solution-architecture-and-data-model.md` already documents for it. It is not a numbered schema migration (`lib/db/migrations/`) and carries no ongoing sync -- it is a single snapshot import, run once per target database.

**Source and mapping.** The legacy WordPress site exposes all public content as "posts" under `https://idoc.club/wp-json/wp/v2/posts`, distinguished only by category. The importer fetched every published post's full body (not just index/excerpt data) and split them by category into:

| Legacy category | Count | Target table | Notes |
|---|---|---|---|
| `homepage-news` | 27 (26 imported) | `idoc.news_articles` | One post (`ga-assembly2024`) is excluded; see below. |
| `president-blog` | 7 | `idoc.news_articles` | Same unified News/Blog table as News; see docs/01 and docs/08. |
| `seminars` | 4 | `idoc.seminars` | See seminar caveats below. |

Article `content_html` is passed through the same tag allowlist as `lib/news/sanitize.ts` before storage, so imported rows already match what the application itself would persist on save. `idoc.seminars.description` is a plain-text column; each seminar's legacy body was converted to plain text and prefixed with its source URL. Legacy titles that embedded a byline (`"<Title><br/>by <Author>"`) were split into `title`/`subtitle`; other articles fall back to the legacy WordPress excerpt for `subtitle`.

**Linked PDF attachments.** Every `wp-content/uploads/...` PDF the imported `content_html` linked to (course/meeting documents, statements) was downloaded and committed under `public/documents/{general-assembly,governance,news}/`, and the links rewritten to the absolute `https://idoc.club/documents/...` production URL -- `lib/news/sanitize.ts` only allows an absolute `http(s):`/`mailto:` `href`, so a root-relative link would have been silently stripped on save/render. The same rewrite was applied to the static General Assembly and governance document links in `lib/content/site.ts` (those use root-relative `/documents/...`, since that page renders the href directly rather than through the sanitizer). This was necessary independent of any database import: once the legacy WordPress site is retired, `idoc.club/wp-content/uploads/...` URLs stop resolving entirely, breaking every one of these links wherever they are referenced.

**Administrator review required before use:**

- **Current execution limitation.** The full SQL currently has a seminar INSERT column/value count defect. The news portion has been verified independently, including idempotency and absence of email/live billing under the launch hold. Resolve and verify the seminar defect before using the full import; this content check does not verify a bulk member import. See [the launch checklist](27-member-communications-and-billing-launch-hold.md).
- **Excluded content.** `ga-assembly2024`'s legacy page body is a MemberPress "you are unauthorized to view this page" placeholder -- the real member-gated content was never exposed to the public REST API. It is intentionally omitted rather than imported as a broken article; someone with legacy site admin/member access should retrieve and add its real content separately.
- **Seminar structured fields.** The legacy site only ever published narrative course announcements, not a structured registration record, so several `NOT NULL` `idoc.seminars` columns have no legacy source value and are filled with a documented assumption (start/end time defaulted to 09:00-17:00; a missing registration deadline defaulted to 14 days before the seminar; `non_member_price_cents` imported equal to `member_price_cents`, since the legacy site never distinguished the two; a multi-day event's `end_date` holds only its first day, matching `start_date`, with the full range preserved in `description`). Every such value is marked `ASSUMPTION` in the script and must be confirmed by an administrator before a seminar is relied on for real registrations. There is no legacy payment-method assumption to make: payment method is chosen per registration (migration `0055`), not set on the seminar.
- **Currency mismatch.** Two Hartpury Para Dressage courses stated their legacy fee in GBP 150, not EUR. Since `idoc.seminars` has no currency column and both docs/07 and `lib/seminars/checkout.ts` treat every seminar price as EUR, importing that amount as `member_price_cents=15000` (and the same for `non_member_price_cents`) and publishing it would silently sell a GBP course at the wrong price and currency. Both rows are imported as `status='draft'` (never public) with the GBP amount preserved as-is, pending an administrator setting correct EUR-equivalent prices before publishing.

**Idempotency and reconciliation.** `idoc.news_articles` inserts use `ON CONFLICT (slug) DO NOTHING`; `idoc.seminars` inserts use a `NOT EXISTS` guard on `(title, start_date)`, since that table has no natural unique key. Re-running the script is safe and a no-op on rows already imported. Every row the script actually inserts also gets one `idoc.audit_log` row (`admin.news_article.created` / `admin.seminar.created`, matching the shape `lib/news/articles.ts` / `lib/seminars/seminars.ts` themselves write on creation), attributed to an administrator resolved at run time -- so `select count(*) from idoc.audit_log where action in ('admin.news_article.created','admin.seminar.created') and after_json->>'title' is not null` after a run is the reconciliation count against the mapping table above.

**Rollback.** This import only creates rows (no update/delete of existing data), so rollback is deleting the specific imported rows by slug/title if needed; it never touches Stripe or membership data and carries none of the billing-continuity risk in [Rollback rule](#9-rollback-rule) above.

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
