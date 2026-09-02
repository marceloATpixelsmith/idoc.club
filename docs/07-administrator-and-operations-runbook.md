**IDOC**

**Administrator & Operations Runbook**

Day-to-day procedures after the IDOC membership platform goes live

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.2                                            |
| **Date**             | 2 September 2026                              |

Working project document. Update this document when project decisions change.

## Codex pull-request review gate

The protected `main` branch requires the commit status `codex/review-complete`. Opening, reopening, marking ready, or updating a pull request places that status in `pending`. A submitted review from the Codex connector identity (`chatgpt-codex-connector` or GitHub's bot-form login `chatgpt-codex-connector[bot]`) changes it to `success` only when the review is attached to the pull request's current head commit. A later push creates a new pending gate, and an older review cannot satisfy it.

After the workflows are present on `main`, configure the repository ruleset for `main` to require `codex/review-complete`. Also require conversation resolution so completing a Codex review does not make unresolved review threads mergeable.

If the Codex review quota is unavailable, a repository administrator or maintainer may run **Codex Review Gate - Quota Waiver** from the Actions tab. Supply the open pull-request number, an audit reason, and the exact confirmation `CODEX_QUOTA_EXHAUSTED`. The workflow resolves the pull request's current head commit, records a successful waiver only for that revision, and posts an audit comment. A later push returns the new revision to pending. Do not use the waiver for ordinary review delays or to avoid actionable review feedback.

# 1. Purpose

This runbook defines normal administrative actions, exception handling and escalation boundaries. It is intended to prevent ad-hoc database edits and preserve a reliable audit trail.

# 2. Normal member lookup

1. Search by name, email, legacy ID or external billing identifier as permitted.

2. Confirm identity using more than one field before making sensitive changes.

3. Review membership status, valid-through date, professional roles and payment source.

4. Review recent audit entries before changing a disputed record.

# 3. Record a bank transfer, PayPal or cash payment

1. Open the existing member record.

2. Select Record payment.

3. Choose payment source.

4. Enter €80 in EUR. Do not enter partial, discounted, or waived payments.

5. Enter actual paid date and reference/transaction evidence.

6. Review the proposed membership validity change.

7. Submit with a reason; every administrator action is audited.

8. Confirm the new payment and audit entry appear.

# 4. Review a member classification or profile change

Members may change every signup/profile field themselves. Administrators receive a notification and can review the complete history of the change. Do not alter the member's paid-through date or billing relationship merely because classification information changed.

# 5. Change judge/steward level

1. Verify the official IDOC source/authorization for the level change.

2. Open Professional roles.

3. End-date the prior level record if history is retained.

4. Create/activate the new level with effective date.

5. Add a concise administrative reason/source.

6. Confirm the audit entry.

# 6. Convert professional category

Do not overwrite unrelated roles. For a member becoming Judge + Steward, retain the Judge role and add a Steward role with its own level. For a role that genuinely ends, close/end-date that role rather than erasing history.

Before approving a classification change, confirm that every field required by the target classification is present and valid under the approved field dictionary. A Steward becoming a Judge must supply a valid Judge status and Technical Delegate answer. A member becoming Judge + Steward must have both valid Judge and Steward statuses. Veterinarians require only the common member fields. Professional changes do not create a new membership or alter the €80 billing cycle.

# 7. Stripe billing issue

| **Situation**                | **Action**                                                                                                           |
|------------------------------|----------------------------------------------------------------------------------------------------------------------|
| Payment failed               | Check local event record and Stripe status; Stripe retries automatically; member remains active for five days, then expires if unpaid. Do not manually mark paid without evidence. |
| Member updated card          | Normally no local action; Stripe Customer Portal/next invoice handles it.                                            |
| Member canceled auto-renew   | Confirm cancel-at-period-end; membership remains active through paid-through date.                                   |
| Member enables auto-renew    | Confirm payment authorization and future activation exist; verify no immediate charge and no start before the current paid-through date. |
| Member reverses pending choice | Confirm the pending transition was canceled/replaced and that only one future billing path remains.                 |
| Subscription missing locally | Do not create a second subscription. Reconcile by verified Stripe Customer/Subscription ID.                          |
| Duplicate charge concern     | Inspect Stripe invoices/payments and local idempotency/audit records before changing membership.                     |
| Reconciliation flags an anomaly | Review the finding on the Stripe reconciliation report (§13.1). Confirm against Stripe directly before acting; correct through the normal suspend/reinstate/entitlement-correction tools — never edit `reconciliation_findings` directly, and never let the report's own presence stand in for verified evidence. |

# 8. Manual correction policy

- Never edit production database rows directly for routine membership corrections.

- Use the admin interface so validation, reason capture and audit logging are applied.

- If an emergency database correction is unavoidable, document the incident, exact rows changed, actor, reason and before/after values.

- Do not delete payment history to make a screen look correct; correct the relationship/status and preserve evidence.

# 9. Member says they cannot log in

1. Confirm the member exists and the email address on record is correct.

2. Check account activation/verification status without changing membership entitlement.

3. Use the supported password-reset/magic-link workflow.

4. Do not manually set or ask for the member's password.

For an Administrator or Super Admin password-reset request, the recovery screen requires the
account's active authenticator factor and never sends or falls back to an email OTP. If the factor
is unavailable or missing, direct the person through approved identity-verification and support
handling; do not enroll or replace an authenticator inside anonymous recovery. If the user retained a recovery code, they must complete password or Google primary sign-in, choose recovery at the MFA challenge, replace and prove a new authenticator, and acknowledge newly rotated recovery codes. This self-service event revokes prior sessions; support must never request a recovery code or authenticator secret. Successful reset
revokes all persisted sessions and requires a fresh sign-in.

5. If email delivery is failing, investigate provider logs and account email rather than creating a duplicate account.

# 10. Member says membership is incorrectly expired

1. Check valid-through date and status.

2. Review recent payments and Stripe subscription/current period if Stripe-backed.

3. Review manual payment records and audit history.

4. Correct only after evidence identifies the intended entitlement.

5. Record reason/source for any manual extension.

6. Confirm the five-calendar-day grace rule was applied whether the prior term ended after a failed recurring charge or a non-recurring paid-through date. During grace the person retains full member access; after grace the account receives only payment and logout.

# 11. Security incident escalation

- Suspected unauthorized administrator access: revoke affected sessions/credentials and escalate immediately.

- Suspected secret leakage: rotate the affected Vercel, Render PostgreSQL, application-authentication, or Stripe secret, then investigate logs and the exposure window.

- Suspected cross-member data exposure: disable affected feature if necessary and treat as a privacy/security incident.

- Webhook signature failures: verify endpoint/secret configuration; never bypass signature verification to restore service.

- Database integrity anomaly: preserve evidence/backups before attempting broad corrective writes.

# 12. Routine operational checks

| **Frequency**      | **Check**                                                                                                                       |
|--------------------|---------------------------------------------------------------------------------------------------------------------------------|
| Daily/regularly    | Failed Stripe webhooks, renewal failures, review-required members, application errors.                                          |
| Weekly             | Manual payment exceptions, unresolved migration anomalies during stabilization, unusual admin actions.                          |
| Monthly            | Active member counts versus billing/manual-payment expectations; access review for administrators.                              |
| Quarterly          | Dependency/security updates, authorization and member-data-isolation spot-check, and Render PostgreSQL backup/recovery posture. |
| When staff changes | Immediately remove or adjust administrative access.                                                                             |

## 12.1 Vercel Pro operational controls

| **Area** | **Procedure** |
|---|---|
| Preview access | Share protected previews only with current project reviewers; never use Preview to inspect or edit production member data. |
| Environment variables | Enter, rotate and remove secrets only in approved Vercel project settings and target environment; never paste them in tickets, PRs, logs, screenshots or chat. |
| Firewall/WAF | Document purpose, scope and rollback before changes, then test affected account, admin and Stripe flows. |
| Observability/logs | Record deployment, timestamp, safe error ID and affected workflow; do not export unredacted member data or secrets. |
| Scheduled jobs | Check prior effects before retries; escalate repeated failure, missed runs and duplicate-effect evidence. |

### Account-delivery schedule

Configure `CRON_SECRET` as a sensitive, server-only Vercel environment variable in Production; documentation, tickets, logs, and source control must never contain its value. Vercel Cron calls `/api/cron/account-delivery` on `*/5 * * * *` (every five minutes, UTC). A run handles at most 20 account-link records. Monitor non-sensitive delivered, retryable, dead-lettered, ineligible, and lease-lost counts; investigate repeated failures without recording member addresses, tokens, decrypted payloads, credentials, keys, exception text, or environment values. An expired or otherwise invalid queued link is not replaced by the worker; the member must make a new neutral recovery or activation request.

Retry delay is `min(3,600, 30 × 2^(attempt − 1))` seconds according to the current attempt number; attempt six is retained as dead-lettered and is not claimable again. Do not manually clear a live lease. Reconciliation may reclaim an expired lease, but the stable message identifier must be preserved so a provider success followed by a database-finalization failure cannot create an uncontrolled new identity. Cron responses expose only aggregate delivered, retryable, dead-lettered, ineligible, and lease-lost counts.

### Stripe reconciliation-scan schedule

Vercel Cron calls `/api/cron/reconciliation-scan` on `0 7 * * *` (daily, UTC — an hour after the renewal-notice scan). It is gated by the same `CRON_SECRET` bearer header as every other Cron route. A run replaces the current findings snapshot only on success; a failure (e.g. Stripe temporarily unreachable) leaves the prior snapshot untouched and is recorded as a failed run, and the Cron route itself returns a non-2xx status so a missed or broken run is visible in Vercel's own Cron monitoring, not just on the `/admin/reconciliation` page. Investigate a run of consecutive failures the same way as any other Cron failure (§12) before assuming a specific finding is stale.

### Data-retention-purge schedule

Vercel Cron calls `/api/cron/data-retention-purge` on `0 8 * * *` (daily, UTC — an hour after the reconciliation scan), gated by the same `CRON_SECRET` bearer header as every other Cron route. Each run permanently deletes rows from `email_otp_codes`, `mfa_challenge_transactions`, `mfa_enrollment_transactions`, `account_tokens`, `auth_sessions`, and `login_trusted_devices` once each row's own expiry is more than 30 days in the past (`lib/security/data-retention-purge.ts`). This is routine, expected data loss by design — do not treat a nonzero delete count as an anomaly requiring investigation, and do not attempt to restore purged rows from a backup (§12.2): they were already logically unauthorized well before physical deletion.

## 12.2 Render PostgreSQL backup and recovery

The production database runs on Render, whose **Hobby** plan includes two backup mechanisms automatically — nothing in this codebase implements or manages either of them:

- **Point-in-time recovery (PITR).** Render continuously archives write-ahead log data. On the Hobby plan, this gives a **3-day recovery window** — a new database can be restored to any point within the last 3 days. (Render's Pro tier and above extend this to 7 days; upgrading does not retroactively extend an already-elapsed window, only going forward.)
- **Logical backups.** Render also retains an exportable logical (`pg_dump`-style) backup, created and retained for **7 days**, downloadable from the Render dashboard.

**What this means operationally:**

- A data-corruption or destructive-write incident discovered **within 3 days** can be recovered via PITR — restore to a new Render Postgres instance at a timestamp just before the bad write, verify, then cut the application over (`POSTGRES_URL`) to the restored instance. This is a Render dashboard operation, not something scripted in this repository.
- An incident discovered **after the 3-day window has elapsed** cannot be recovered via PITR at all — this is the single most consequential fact an operator must know about this backup posture, and is exactly why the quarterly check below exists.
- A restore is a genuinely destructive, production-affecting operation (a new database instance, a `POSTGRES_URL` cutover, and a window of data loss between the incident and the restore point) — treat it with the same care as any other action in this category (see the top-level operating principles this document opens with), and prefer read-only investigation via a database export or replica-like inspection before deciding a restore is actually necessary.

**Quarterly verification (§12's existing "Render PostgreSQL backup/recovery posture" line refers to this procedure):**

1. Confirm in the Render dashboard that the production database is still on a paid plan (PITR and logical backups are **not** available on Render's free tier at all) and that PITR is showing as active with a 3-day (or better) window.
2. Confirm a recent logical backup exists and is downloadable.
3. This is a posture check, not a restore drill — actually restoring to a scratch/staging Render instance to prove the procedure works end-to-end is valuable but is a separate, deliberate exercise to schedule on its own, not something to perform against production as part of this routine check.

### Mandatory post-restore reconciliation

A point-in-time restore rolls the entire database back to an earlier moment — including every security-relevant row this application relies on being current. A restore that is not followed by this reconciliation can silently **resurrect** a session, account, or role grant that had been correctly revoked between the restore point and the incident. This is not optional cleanup; complete it before resuming production traffic against the restored database:

1. **Rotate `AUTH_SECRET` immediately, using the hard-cutover procedure (§15.2), not the graceful-overlap one -- including its step to clear `AUTH_SECRET_RETIRED_KEYS` entirely.** Every session cookie is a JWT signed with this secret and is only ever honored alongside a matching, non-revoked `idoc.auth_sessions` row — but a restore can bring back a since-revoked row (its `revoked_at` un-set again) exactly as it existed at the restore point. `AUTH_SECRET` supports a graceful, non-disruptive overlap rotation for routine use (§15.2), but this specific situation calls for the opposite: clear any existing `AUTH_SECRET_RETIRED_KEYS` entries (a routine rotation's overlap window may still be active) and set a new `AUTH_SECRET` value, so every existing session JWT is invalidated regardless of what the restored database now says, closing this off unconditionally rather than depending on a manual per-row audit to catch every case.
2. **Re-apply any account suspension, deletion, or role revocation that happened between the restore point and the incident.** Compare the restored `idoc.users.account_state`/`deleted_at`, `idoc.memberships.status`, and `idoc.application_roles.revoked_at` against the most recent pre-incident audit-log export (`/admin/exports`) or admin recollection of recent actions, for that specific window. Manually re-apply anything the restore rolled back (re-suspend, re-delete, re-revoke) before treating the restored database as authoritative.
3. **TOTP/session encryption keys need no restore-specific action.** Key material lives in Vercel environment configuration, not the Postgres database, so a database restore cannot resurrect a key that was deliberately removed from the active key ring for being compromised — a restored `mfa_factors` row encrypted under a since-removed key simply fails to decrypt (a safe failure), it does not become usable again.

# 13. Data export and reporting

Administrative exports should be generated through authorized server-side reporting functions. Export only the fields necessary for the stated business purpose and avoid distributing raw migration exports or unnecessary billing identifiers.

## 13.1 Stripe reconciliation report

Any administrator can view `/admin/reconciliation`, a read-only report refreshed daily by the reconciliation-scan Cron job (see §12.1). It lists the current findings — subscription status conflicts, orphaned active Stripe subscriptions, repeated payment failures, and unlinked Stripe Customers (docs/04 §9) — and the timestamp/outcome of the last run, so a stopped or failing job is visible rather than silently read as "no anomalies." The page performs no writes of its own; act on a finding as described in §7's table.

# 14. Decommissioning legacy IDOC WordPress membership

1. Keep the archival legacy export/backup available through the agreed stabilization period.

2. Confirm all post-cutover discrepancies are resolved.

3. Take an archival export/backup according to IDOC retention requirements.

4. Remove obsolete MemberPress/IDOC payment webhooks and scheduled jobs only after confirming the new platform is authoritative.

5. The other former multisite sites will already have been retired independently; retire the IDOC WordPress site only after acceptance is complete.

6. Document the final decommission date and retained archive location.

## Production runtime configuration boundary

Production runtime requires explicit `POSTGRES_URL`, `AUTH_SECRET`, HTTPS `BASE_URL`, `ACCOUNT_DELIVERY_KEY_VERSION`, `ACCOUNT_DELIVERY_ENCRYPTION_KEYS`, `RATE_LIMIT_HASH_KEY`, `CRON_SECRET`, `MAILCHIMP_TRANSACTIONAL_API_KEY`, `IDOC_ADMIN_NOTIFICATION_EMAIL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MEMBERSHIP_PRODUCT_ID`, `TURNSTILE_SECRET_KEY`, `MFA_PENDING_AUTH_SIGNING_KEY`, `MFA_TOTP_ACTIVE_KEY_ID`, `MFA_TOTP_ENCRYPTION_KEYS`, and `MFA_RECOVERY_CODE_DIGEST_KEY`. Secrets must be at least 32 characters where applicable, the Stripe membership Product ID must match Stripe's `prod_...` identifier shape, and each active key/version must resolve to material in its corresponding key ring. Never add compilation placeholders. A deployment build intentionally succeeds without these values, while each privileged runtime boundary fails closed until its real configuration exists. Until the code migration in docs/25 is complete, the deployed implementation still expects the legacy pair `STRIPE_RECURRING_PRODUCT_ID` and `STRIPE_ONE_TIME_PRODUCT_ID`; do not remove them from an existing environment before the replacement code is deployed.

The live privileged-MFA variables use these formats:

- `MFA_PENDING_AUTH_SIGNING_KEY`: base64url-encoded key material representing at least 32 random bytes; rotate by replacing the value and expect outstanding pending-MFA continuations signed with the retired key to require a fresh primary login.
- `MFA_TOTP_ACTIVE_KEY_ID`: the active TOTP encryption-key identifier, for example `v1`.
- `MFA_TOTP_ENCRYPTION_KEYS`: a server-only JSON object mapping accepted key IDs to base64url-encoded **exactly 32-byte** AES-256 keys, for example `{"v1":"..."}`. Keep old key IDs present while factors encrypted under them still exist; re-encrypt/rotate factors before removing a retired key ID.
- `MFA_RECOVERY_CODE_DIGEST_KEY`: base64url-encoded key material representing at least 32 random bytes. Rotating it invalidates outstanding recovery-code digests unless they are regenerated under the new key, so coordinate rotation with privileged-account recovery-code replacement.

Store all four as sensitive server-only Vercel environment variables in every environment where privileged MFA login is expected to work. Do not expose them through `NEXT_PUBLIC_*`, logs, screenshots, tickets, or documentation values. Before production enablement, verify the active TOTP key ID exists in `MFA_TOTP_ENCRYPTION_KEYS` and perform an Administrator/Super Admin enrollment-and-login UAT pass; a missing or malformed value intentionally fails closed and can otherwise lock privileged users out.

The signup/login/password-reset Turnstile challenge additionally requires `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (client-visible by design — it identifies the Turnstile widget, not a secret) alongside the server-only `TURNSTILE_SECRET_KEY` above. Without the public key the widget renders nothing and the signup submit button stays permanently disabled; without the secret key every server-side verification fails closed.

`STRIPE_MEMBERSHIP_PRODUCT_ID` identifies the one IDOC Annual Membership Product against which Checkout builds recurring or non-recurring €80 Price configurations. Stripe requires different Price configurations for the two billing modes, not separate Products. The Product and both technical Price modes represent the same membership entitlement and are never shown as competing plans.


## Ordinary login trusted-device operations

Set `LOGIN_DEVICE_TRUST_DIGEST_KEY` to a dedicated base64url-encoded secret of at least 32 random bytes in every runtime that serves password login. Keep it server-only and do not reuse session, password, TOTP-encryption, or recovery-code keys. Losing or rotating this single active key safely invalidates all existing ordinary-member trusted-device cookies; deploy the new key consistently before relying on newly issued trust. Individual or account-wide emergency revocation can set `idoc.login_trusted_devices.revoked_at` and an operational `revoke_reason`; revocation takes effect on the next login. Do not delete or mutate factor-bound `mfa_remembered_devices` for this purpose.

## Account-security management operations

Members manage password, Google sign-in, active canonical sessions, remembered ordinary login devices, privileged authenticators, and deletion at `/dashboard/security`. Support should not invent browser, device, location, or IP descriptions: the session registry currently stores only authentication, activity, and absolute-expiry timestamps. "Log out other sessions" intentionally preserves the server-bound current session; password change and account deletion intentionally require fresh sign-in.

Administrator and Super Admin users never use ordinary remembered-login-device trust. Their security page links into the established authenticator recovery/replacement flow, which requires current TOTP or a one-time recovery code, rotates recovery codes, invalidates sessions, and requires acknowledgement before a fresh normal session. Item 8's broader notification and audit sweep remains an operational follow-up; this surface adds only mutation evidence consistent with current audit conventions.

## Security-notification operations

The five-minute account-delivery Cron also drains durable authentication-security notices. Each notice snapshots its recipient and event creation time, retries with the existing six-attempt exponential policy, and dead-letters after attempt six. Provider failure never reverses a password, email, factor, role, or session mutation. Operators may inspect only kind, user ownership, timestamps, attempt/lease state, dedupe identity, and categorical delivery error. Never add credential material, raw session/device identifiers, IP/location guesses, exception text, or provider responses to evidence. A dead-letter requires confirming current account ownership before an approved manual communication; never re-run the underlying security mutation merely to send email.

## Security event logging (AUTH-LOG-001, AUTH-LOG-003)

`lib/observability/logger.ts`'s `logWarn`/`logError` emit only names registered in `lib/observability/security-events.ts`'s `SECURITY_EVENT_TAXONOMY` -- an unregistered name is a TypeScript compile error, not a runtime possibility. Every emitted line carries a server-generated correlation id (never client-supplied), the taxonomy's `category` and `resource` for that event (auto-attached; a caller cannot override them), and a `retentionClass`: `security` (a real or attempted-attack signal -- an invalid webhook signature, an auth-flow failure) or `operational` (routine ops/delivery noise). This deployment has no separate self-hosted log store; Vercel's platform log retention governs actual duration. Configure the platform's retention window to keep `retentionClass: 'security'` lines available for at least 90 days where the plan allows a longer window than the default, since these are the lines an incident investigation needs; `operational` lines may use the platform default. Metadata is capped to 16 flat primitive entries per line (arrays/objects are dropped, oversized strings truncated at 2000 characters) before it ever reaches the sink -- never rely on a caller to have redacted a request/response body by hand.

Security events (`lib/observability/logger.ts`) remain a distinct channel from `idoc.audit_log` (`docs/07` elsewhere, `lib/db/schema.ts`): the audit log is the actor-attributed, append-oriented record of security-sensitive state *changes*; the security-event log is operational/diagnostic and covers failures, not committed mutations.

# 15. Production authentication configuration and UAT

This section is the authoritative production-auth configuration inventory. The application is one Vercel-hosted Next.js deployment; its Cron route runs in that deployment and no separate authentication worker is deployed elsewhere. Put server-only values in **Vercel Project Settings → Environment Variables**, scoped separately to Production and to the protected Preview/Staging deployment used for UAT. Preview/Staging must use its own non-production database, OAuth client/configuration, provider credentials, and cryptographic secrets. All instances within one environment must receive the same compatible values. Never put real values in `.env.example`, Git, documentation, issues, pull requests, chat, screenshots, build output, or runtime logs.

## 15.1 Authoritative inventory

“Rotate” below means an operator-coordinated deployment, never an application-generated fallback.

| Variable | Requirement, consumer, and format | Rotation and environment rules |
|---|---|---|
| `AUTH_SECRET` | Required server-only UTF-8 text of at least 32 characters. `lib/auth/session.ts` uses it as the active HS256 JWT signing key for the canonical session cookie; it also signs OAuth browser binding and other short-lived transient authorities (pending signup/login/password-reset, Google-link fresh evidence). | Must match across instances. See the rotation procedure below: an ordinary rotation is now a graceful overlap for session cookies, not a hard cutover. The short-lived transient authorities (all ≤15 minutes) are still a hard cutover on rotation by design -- simply retrying that step is a negligible cost, and they were left out of the ring to keep this change minimal. Use a distinct staging value. |
| `AUTH_SECRET_RETIRED_KEYS` | Optional server-only JSON array of prior `AUTH_SECRET` values, each at least 32 characters. Unset (the default) is a single-key ring identical to before this variable existed. | Not itself rotated -- populated and drained as part of the `AUTH_SECRET` rotation procedure below. Never include the *current* `AUTH_SECRET` value in this list. |
| `BASE_URL` | Required absolute application origin. HTTPS is mandatory in production; loopback HTTP is accepted only outside production. Used for trusted application origins and links. No trailing route; production is `https://idoc.club` when that is the deployed canonical origin. | Not secret. Must match across instances and the deployed origin. A change requires OAuth/callback and email-link review; use the actual staging origin in staging. |
| `POSTGRES_URL` | Required server-only `postgres:`/`postgresql:` URL for the Render PostgreSQL database; production requires provider TLS configuration. Stores users, session registry, factors, challenges, devices, audit, and durable notification outbox. | Rotate the database credential using Render/Vercel coordination. It does not logically revoke auth material, but an incompatible cutover makes auth fail closed. Never share the production database/credential with staging. |
| `MFA_TOTP_ACTIVE_KEY_ID` | Required 1–30 character key ID (`A-Z`, `a-z`, digits, `_`, `-`). Selects the encryption key for newly enrolled factors and must exist in the TOTP ring. | Not secret, but must match the ring on every instance. Change only as part of the additive procedure below. Staging has an independent ring. |
| `MFA_TOTP_ENCRYPTION_KEYS` | Required server-only JSON object from key ID to **unpadded canonical base64url**, each decoding to exactly 32 bytes (AES-256-GCM). Decrypts persisted privileged TOTP factors. | Must be compatible across instances. Additive rotation is safe; old IDs must remain until no factor references them. Removing a referenced key locks out that factor. Use a distinct staging ring. |
| `MFA_TOTP_COMPROMISED_KEY_IDS` / `MFA_TOTP_RETIRED_KEY_IDS` | Optional server-only JSON arrays of non-secret key IDs already present in `MFA_TOTP_ENCRYPTION_KEYS`. Unset (the default) is empty for both. A key ID may be in at most one list. `COMPROMISED` blocks the ID from new encryption and from decrypting old factors; `RETIRED` is an operator declaration that a key is fully decommissioned, cross-checked at read time against real `idoc.mfa_factors` usage (`mfaEncryptionKeyLifecycle`) rather than trusted blindly. | Declare `COMPROMISED` immediately on suspected exposure -- it takes effect on deploy, independent of the `AUTH_SECRET` compromise procedure below. Only add an ID to `RETIRED` after the same database inventory required by step 5 of the TOTP rotation procedure confirms no live (`pending`/`active`/`disabled`) factor references it; the app flags a mismatch rather than silently trusting a wrong declaration. Distinct per environment. |
| `MFA_RECOVERY_CODE_DIGEST_KEY` | Required server-only unpadded canonical base64url decoding to at least 32 bytes. Keys persisted one-time recovery-code digests. | Must match across instances. Rotation intentionally invalidates every existing recovery code; old values are not consulted. Coordinate regeneration/re-enrollment and test only with a disposable staging account. Distinct per environment. |
| `MFA_PENDING_AUTH_SIGNING_KEY` | Required server-only unpadded canonical base64url decoding to at least 32 bytes. Signs short-lived MFA enrollment/login/reset/replacement/step-up continuation authority. | Must match across instances. Rotation safely invalidates outstanding continuations; no old key is needed. Begin fresh flows after deployment. Distinct per environment. |
| `LOGIN_DEVICE_TRUST_DIGEST_KEY` | Required server-only unpadded canonical base64url decoding to at least 32 bytes. Keys digest-only persisted ordinary-member 14-day login-device tokens. | Must match across instances. Rotation safely invalidates all remembered ordinary devices; no old key is needed. It does not bypass password+OTP recovery. Distinct per environment. |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Both required when Google auth is enabled; Google-issued server configuration consumed by the canonical OIDC flow. The secret has provider-defined format. | Must match the configured OAuth client across instances. Rotate the secret through an overlap/cutover supported by Google; existing IDOC sessions are unaffected, in-flight OAuth may fail. Production and staging must use separate clients/secrets. See the versioned-ring alternative below for a bounded-overlap rotation instead of a hard cutover. |
| `GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS` / `GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION` | Optional server-only alternative to `GOOGLE_OAUTH_CLIENT_SECRET`: a JSON object from a 1-30 character version label to the corresponding Google-issued secret, plus the version label currently in use. Unset (the default) uses the plain `GOOGLE_OAUTH_CLIENT_SECRET` form unchanged. Setting `ACTIVE_VERSION` without a matching `VERSIONS` map fails closed rather than silently falling back to the legacy value. | Add the new version to `VERSIONS` before flipping `ACTIVE_VERSION` to it; keep the prior version in `VERSIONS` for rollback (revert the pointer only, never re-enter the secret) until no instance needs it. After deploying with the new version active, run `pnpm google:rotate-secret --to-version=<new> --reason=scheduled_rotation` (or `rollback` / `compromise_response`) to record the secret-free audit entry. Distinct ring per environment. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Required absolute HTTPS callback URI outside local development. It must be exactly `${BASE_URL}/api/auth/google/callback` for the deployed canonical origin and exactly match a Google authorized redirect URI. | Not secret; exact-match across instances and provider console. Each stable protected staging origin needs its own explicit callback. Do not use arbitrary per-PR hosts with the production client. |
| `MAILCHIMP_TRANSACTIONAL_API_KEY` | Required server-only Mailchimp Transactional/Mandrill-issued API key (provider-defined length). Delivers login OTP and durable security/account messages. | Rotate in Mailchimp and Vercel; queued messages remain in PostgreSQL and retry with the new credential. It does not invalidate auth material. Use a non-production account/key or tightly controlled test subaccount in staging. |
| `CRON_SECRET` | Required server-only random text of at least 32 characters. Vercel Cron presents it as `Authorization: Bearer …` to `/api/cron/account-delivery`; the worker handles retry/dead-letter delivery. | Must match all instances and scheduler. Rotation can temporarily cause 401s and delay mail but does not invalidate auth state; update scheduler/deployment compatibly. Distinct per environment. |
| `ACCOUNT_DELIVERY_KEY_VERSION` / `ACCOUNT_DELIVERY_ENCRYPTION_KEYS` | Required active 1–30 character version plus server-only JSON version ring. Ring values are the existing encrypted-outbox key format (at least 32 characters). Protects raw, short-lived account-link payloads until delivery. | Add the new value/version before switching active; retain old versions until no pending row references them. Removal makes affected pending deliveries fail safely. Same compatible ring across instances; distinct staging ring. |
| `RATE_LIMIT_HASH_KEY` | Required server-only random text of at least 32 characters. Keys privacy-preserving authentication-adjacent rate-limit identifiers. | Must match across instances. Rotation loses continuity of existing rate-limit buckets and should occur only during a controlled window; it does not revoke sessions/factors. Distinct per environment. |
| `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Required Cloudflare server verification secret (at least 32 characters under runtime validation) and intentionally public site key. Protect anonymous auth boundaries. | Configure as a matched Cloudflare widget pair for each allowed hostname. Secret is server-only; site key may reach browsers. Rotation does not revoke auth material. Do not reuse production secret in staging. |
| `IDOC_ADMIN_NOTIFICATION_EMAIL` | Required syntactically valid operations recipient for privileged production configuration alerts/workflows. Also the recipient for breached-password rejection alerts (docs/21 AUTH-PASSWORD-007) and the `Contact:` address published at `/.well-known/security.txt` (docs/21 AUTH-SUPPLY-002) — one operations mailbox, not a separate secret per purpose. | Not cryptographic; keep consistent across instances and use the appropriate staging recipient. |

`STRIPE_*` and product variables are production runtime requirements but are intentionally outside this authentication inventory and are unchanged by this readiness work.

## 15.2 Generating and rotating keys

Generate each self-managed 32-byte base64url secret independently in an approved operator terminal, then transfer it directly to the deployment secret store without printing it into retained logs:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Use that output for each base64url digest/signing key. For the TOTP ring, assign a non-secret ID and construct valid JSON only inside the Vercel secret editor. `AUTH_SECRET`, `CRON_SECRET`, and `RATE_LIMIT_HASH_KEY` may use independently generated high-entropy values; never reuse one secret for two purposes.

Safe TOTP encryption rotation is strictly additive:

1. Generate a new 32-byte key and choose a new key ID.
2. Add it to `MFA_TOTP_ENCRYPTION_KEYS` while retaining every old ID.
3. Set `MFA_TOTP_ACTIVE_KEY_ID` to the new ID and deploy all instances.
4. Confirm new enrollment/replacement stores the new ID and an old factor still verifies.
5. Retire an old ID only after a database inventory confirms no factor references it. There is no automatic re-encryption.

`AUTH_SECRET` session-cookie rotation has two distinct procedures depending on why you are rotating:

**Routine rotation (no suspected compromise) -- graceful overlap, no forced sign-in:**

1. Copy the current `AUTH_SECRET` value into `AUTH_SECRET_RETIRED_KEYS` (a JSON array; append to any existing entries rather than replacing them).
2. Set `AUTH_SECRET` to a newly generated value and deploy all instances together (both variables must land in the same deploy).
3. Outstanding session cookies signed under the retired value keep verifying and naturally re-sign under the new active value the next time `middleware.ts` refreshes their idle activity -- no forced sign-in occurs. The 15-minute transient authorities (pending signup/login/password-reset, Google-link fresh evidence, OAuth browser binding) are a hard cutover regardless: an in-flight one of those flows must be restarted, a negligible cost given their short lifetime.
4. After 12 hours plus one idle-refresh interval (comfortably 13 hours; the session absolute cap is `SESSION_ABSOLUTE_SECONDS`), every session has either refreshed onto the new key or expired on its own. Remove the retired value from `AUTH_SECRET_RETIRED_KEYS` and redeploy -- there is no automatic expiry of ring entries.

**Suspected compromise, or the mandatory post-restore reconciliation in §12.2 -- immediate hard cutover, forced sign-in intended:**

1. **Clear `AUTH_SECRET_RETIRED_KEYS` entirely -- unset it or set it to `[]` -- even if you believe it is already empty.** If a routine rotation's overlap window (the procedure above) was still in progress, its retired entry is still valid for verification; leaving it in place would let session cookies signed under that older key keep verifying right through this "immediate" cutover, silently defeating it. Set `AUTH_SECRET` to a newly generated value in the same deploy. Do **not** carry the old value into `AUTH_SECRET_RETIRED_KEYS`.
2. Deploy. Every existing session cookie -- and every transient authority -- fails verification immediately, exactly as rotation behaved before `AUTH_SECRET_RETIRED_KEYS` existed. This is the desired outcome when the prior secret may be compromised, or when closing the restore-resurrected-session risk in §12.2.

## 15.3 Google OAuth readiness

Configure the production Google client with application origin `https://idoc.club` and authorized redirect URI `https://idoc.club/api/auth/google/callback` (or the exact final canonical production origin if it differs). Configure the stable protected staging origin and its exact callback on a separate staging client. The implementation retains persisted, single-use transaction state, PKCE S256, nonce, signed browser binding, exact origin/application/redirect binding, and server-side token/JWKS validation. Callback evidence is consumed atomically. Email equality alone never links an existing account. Explicit linking requires an authenticated session and current password, plus fresh TOTP step-up for privileged users. Privileged Google primary login always continues to TOTP; ordinary Google login follows the existing Google policy and never creates ordinary password-login device trust.

## 15.4 Email and worker signoff

Before auth UAT, invoke the deployed account-delivery Cron with its normal Vercel schedule and verify a successful non-sensitive count response, then use dedicated staging accounts to receive a `login_verification` OTP and at least one durable security event. Confirm delivery in Mailchimp Transactional activity and confirm the PostgreSQL outbox reaches `delivered`. Exercise a controlled provider failure to confirm retry and eventual delivery; exercise only a disposable staged record when checking dead-letter operations. Never send real email in automated tests, never record message secrets, and confirm notification bodies contain no password, OTP, TOTP seed, recovery code, cookie, token, or environment value.

## 15.5 Operator UAT checklist

Record account IDs/timestamps and safe audit/outbox identifiers, never credentials or codes.

### Ordinary member — password login and reset

- [ ] On an unremembered browser, correct password sends `login_verification`; wrong OTP fails and correct OTP succeeds.
- [ ] Without “Remember me”, a fresh login requires OTP again; with “Remember me for 2 weeks”, the same browser bypasses OTP only after password.
- [ ] “Forget this device” and “Forget all remembered devices” remove bypass; expired/revoked trust cannot bypass OTP.
- [ ] Reset request delivers verification; wrong/expired code fails and success changes the password.
- [ ] Reset makes existing sessions and session-version-bound remembered trust unusable, requires fresh sign-in, and delivers a security notification.

### Privileged enrollment, routine login, and reset

- [ ] Password or Google primary auth without a factor requires enrollment; QR/manual seed appears only during enrollment, invalid TOTP fails, and valid TOTP activates.
- [ ] Recovery codes appear once and acknowledgement is required before a normal session; enrollment notification arrives.
- [ ] Every password and Google login requires TOTP; ordinary remembered-device evidence cannot bypass it; wrong and replayed accepted counter fail where testable.
- [ ] No normal session exists before MFA succeeds.
- [ ] Privileged password reset requires TOTP with no email-OTP or remembered-device fallback; success revokes sessions, requires fresh login, and notifies.

### Authenticator recovery/replacement

- [ ] Start replacement on Security; one recovery code grants replacement authority only and creates no normal session.
- [ ] A used code cannot be reused; new enrollment succeeds; old authenticator and old recovery set stop working.
- [ ] Existing sessions are revoked, new codes appear once, acknowledgement is required, canonical completion requires a fresh normal session, and notifications arrive.

### Fresh step-up

- [ ] Verify privileged TOTP step-up for password change, an actual email change, Google link/unlink, role grant/revoke, and every other configured sensitive action.
- [ ] Without fresh authority the action challenges; ordinary remembered evidence cannot satisfy it.
- [ ] Authority is action-, session-, user-, version-, and role-bound, is single-use, and does not recreate the normal session.

### Sessions, roles, email, Google, and deletion

- [ ] With two sessions, Security identifies current; revoking one other stops it; “log out other sessions” preserves current; another user's session cannot be revoked.
- [ ] Promote an ordinary member who has trust: old session is invalid, trust cannot bypass privileged MFA, next login enrolls/challenges, and role notification arrives.
- [ ] Demote an Administrator: privileged sessions invalidate, stale trust does not resurrect, and next ordinary login follows ordinary policy.
- [ ] Email change requires new-address verification; login address changes only afterward; new address receives security notification and old address receives the currently implemented informational notice; current session invalidation and Google binding remain canonical.
- [ ] Google link requires session/current password and privileged step-up; callback cannot replay; email alone does not auto-link; unlink controls work; no account is stranded; notifications arrive.
- [ ] Account deletion requires password and privileged step-up where applicable; afterward sessions/devices fail and the deleted account cannot authenticate.

### Security notifications and staging key-rotation smoke test

- [ ] Real staged delivery succeeds for password changed/reset, email changed, Google linked/unlinked, authenticator enrolled/replaced, recovery code used, role grant/revoke, and mass session revocation; no secret appears.
- [ ] Add/switch a second TOTP key: old factor works and newly replaced factor records the new ID; keep old key while referenced.
- [ ] Rotate login-device digest: old trust stops bypassing, while password plus OTP works.
- [ ] Rotate pending-auth signing: stale continuation fails closed and a new login works.
- [ ] With a disposable staging account only, rotate recovery digest and verify old recovery codes intentionally fail.

## 15.6 Release signoff (leave unchecked until manually proved)

- [ ] Release 1 Verification is green on final deployed code head: __________
- [ ] Production database migrations are applied: __________
- [ ] Required Production auth variables are configured in Vercel: __________
- [ ] Google production origin/callback are configured: __________
- [ ] Security-email delivery and retry operation are verified: __________
- [ ] Privileged TOTP enrollment and password/Google login are verified: __________
- [ ] Ordinary password+OTP and remembered-device behavior are verified: __________
- [ ] Password reset and authenticator recovery/replacement are verified: __________
- [ ] Fresh step-up, session management, and role-change invalidation are verified: __________
- [ ] Production smoke test passed; operator/date/deployment SHA: __________
