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

4. Enter €80 unless an approved exception applies.

5. Enter actual paid date and reference/transaction evidence.

6. Review the proposed membership validity change.

7. Submit with administrator reason if required.

8. Confirm the new payment and audit entry appear.

# 4. Change judge/steward level

1. Verify the official IDOC source/authorization for the level change.

2. Open Professional roles.

3. End-date the prior level record if history is retained.

4. Create/activate the new level with effective date.

5. Add a concise administrative reason/source.

6. Confirm the audit entry.

# 5. Convert professional category

Do not overwrite unrelated roles. For a member becoming Judge + Steward, retain the Judge role and add a Steward role with its own level. For a role that genuinely ends, close/end-date that role rather than erasing history.

Before approving a classification change, confirm that every field required by the target classification is present and valid under the approved field dictionary. A Steward becoming a Judge must supply a valid Judge status and Technical Delegate answer. A member becoming Judge + Steward must have both valid Judge and Steward statuses. Veterinarians require only the common member fields. Professional changes do not create a new membership or alter the €80 billing cycle.

# 6. Stripe billing issue

| **Situation**                | **Action**                                                                                                           |
|------------------------------|----------------------------------------------------------------------------------------------------------------------|
| Payment failed               | Check local event record and Stripe status; follow grace policy; do not manually mark paid without payment evidence. |
| Member updated card          | Normally no local action; Stripe Customer Portal/next invoice handles it.                                            |
| Member canceled auto-renew   | Confirm cancel-at-period-end; membership remains active through paid-through date.                                   |
| Subscription missing locally | Do not create a second subscription. Reconcile by verified Stripe Customer/Subscription ID.                          |
| Duplicate charge concern     | Inspect Stripe invoices/payments and local idempotency/audit records before changing membership.                     |

# 7. Manual correction policy

- Never edit production database rows directly for routine membership corrections.

- Use the admin interface so validation and audit logging are applied.

- If an emergency database correction is unavoidable, document the incident, exact rows changed, actor, reason and before/after values.

- Do not delete payment history to make a screen look correct; correct the relationship/status and preserve evidence.

# 8. Member says they cannot log in

1. Confirm the member exists and the email address on record is correct.

2. Check account activation/verification status without changing membership entitlement.

3. Use the supported password-reset/magic-link workflow.

4. Do not manually set or ask for the member's password.

5. If email delivery is failing, investigate provider logs and account email rather than creating a duplicate account.

# 9. Member says membership is incorrectly expired

1. Check valid-through date and status.

2. Review recent payments and Stripe subscription/current period if Stripe-backed.

3. Review manual payment records and audit history.

4. Correct only after evidence identifies the intended entitlement.

5. Record reason/source for any manual extension.

# 10. Security incident escalation

- Suspected unauthorized administrator access: revoke affected sessions/credentials and escalate immediately.

- Suspected secret leakage: rotate the affected Vercel, Render PostgreSQL, application-authentication, or Stripe secret, then investigate logs and the exposure window.

- Suspected cross-member data exposure: disable affected feature if necessary and treat as a privacy/security incident.

- Webhook signature failures: verify endpoint/secret configuration; never bypass signature verification to restore service.

- Database integrity anomaly: preserve evidence/backups before attempting broad corrective writes.

# 11. Routine operational checks

| **Frequency**      | **Check**                                                                                                                       |
|--------------------|---------------------------------------------------------------------------------------------------------------------------------|
| Daily/regularly    | Failed Stripe webhooks, renewal failures, review-required members, application errors.                                          |
| Weekly             | Manual payment exceptions, unresolved migration anomalies during stabilization, unusual admin actions.                          |
| Monthly            | Active member counts versus billing/manual-payment expectations; access review for administrators.                              |
| Quarterly          | Dependency/security updates, authorization and member-data-isolation spot-check, and Render PostgreSQL backup/recovery posture. |
| When staff changes | Immediately remove or adjust administrative access.                                                                             |

# 12. Data export and reporting

Administrative exports should be generated through authorized server-side reporting functions. Export only the fields necessary for the stated business purpose and avoid distributing raw migration exports or unnecessary billing identifiers.

# 13. Decommissioning legacy IDOC WordPress membership

1. Keep the legacy membership source read-only through the agreed stabilization period.

2. Confirm all post-cutover discrepancies are resolved.

3. Take an archival export/backup according to IDOC retention requirements.

4. Remove obsolete MemberPress/IDOC payment webhooks and scheduled jobs only after confirming the new platform is authoritative.

5. Do not affect unrelated sites in the WordPress Multisite network when removing IDOC-specific functionality.

6. Document the final decommission date and retained archive location.
