**IDOC**

**Administrator & Operations Runbook**

Day-to-day procedures after the IDOC membership platform goes live

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.1                                            |
| **Date**             | 11 August 2026                                 |

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
| Subscription missing locally | Do not create a second subscription. Reconcile by verified Stripe Customer/Subscription ID.                          |
| Duplicate charge concern     | Inspect Stripe invoices/payments and local idempotency/audit records before changing membership.                     |

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

5. If email delivery is failing, investigate provider logs and account email rather than creating a duplicate account.

# 10. Member says membership is incorrectly expired

1. Check valid-through date and status.

2. Review recent payments and Stripe subscription/current period if Stripe-backed.

3. Review manual payment records and audit history.

4. Correct only after evidence identifies the intended entitlement.

5. Record reason/source for any manual extension.

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

# 13. Data export and reporting

Administrative exports should be generated through authorized server-side reporting functions. Export only the fields necessary for the stated business purpose and avoid distributing raw migration exports or unnecessary billing identifiers.

# 14. Decommissioning legacy IDOC WordPress membership

1. Keep the archival legacy export/backup available through the agreed stabilization period.

2. Confirm all post-cutover discrepancies are resolved.

3. Take an archival export/backup according to IDOC retention requirements.

4. Remove obsolete MemberPress/IDOC payment webhooks and scheduled jobs only after confirming the new platform is authoritative.

5. The other former multisite sites will already have been retired independently; retire the IDOC WordPress site only after acceptance is complete.

6. Document the final decommission date and retained archive location.

## Production runtime configuration boundary

Production runtime requires explicit `POSTGRES_URL`, `AUTH_SECRET`, HTTPS `BASE_URL`, `ACCOUNT_DELIVERY_KEY_VERSION`, `ACCOUNT_DELIVERY_ENCRYPTION_KEYS`, `RATE_LIMIT_HASH_KEY`, `CRON_SECRET`, `MAILCHIMP_TRANSACTIONAL_API_KEY`, `IDOC_ADMIN_NOTIFICATION_EMAIL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_RECURRING_PRODUCT_ID`, and `STRIPE_ONE_TIME_PRODUCT_ID`. Secrets must be at least 32 characters where applicable, the two Stripe product IDs must match Stripe's `prod_...` identifier shape, and the active account-delivery version must name a key in the JSON key ring. Never add compilation placeholders. A deployment build intentionally succeeds without these values, while each privileged runtime boundary fails closed until its real configuration exists.

`STRIPE_RECURRING_PRODUCT_ID` and `STRIPE_ONE_TIME_PRODUCT_ID` identify the two Stripe Products membership checkout builds Prices against (docs/08): one billed yearly (auto-renewal), one billed once. Both represent the same €80 membership fee — the split exists because Stripe requires separate Price objects for recurring versus one-time billing, not because of any difference in membership type or amount.
