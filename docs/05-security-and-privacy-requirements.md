**IDOC**

**Security & Privacy Requirements**

Production hardening requirements for member data, administration, Render PostgreSQL, authentication and Stripe

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.1                                            |
| **Date**             | 11 August 2026                                 |

Working project document. Update this document when project decisions change.

# 1. Security objective

Protect member identity, professional information, membership entitlement and billing references through defense in depth. The starter template is scaffolding; production security depends on the IDOC-specific data model, authorization rules, deployment configuration and operational practices.

# 2. Mandatory controls

| **Control**                   | **Requirement**                                                                                                                                                                                                                      |
|-------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Authentication                | Use the application's authentication system with verified email changes, secure session handling and documented account-lifecycle controls.                                                                                            |
| Authorization                 | Every sensitive server action/route checks the authenticated actor and required role/permission.                                                                                                                                     |
| Member data isolation         | Keep the Render PostgreSQL database inaccessible to browsers. Enforce authenticated-user ownership and administrator permissions in every server-side data operation, using default-deny behavior.                                   |
| Database credential isolation | The Render PostgreSQL connection URL and credentials are server-only Vercel environment variables; never expose them through NEXT_PUBLIC\_\* variables, client bundles or browser responses. Production connections require TLS/SSL. |
| Stripe secrets                | Stripe secret and webhook signing secret are server-only Vercel environment variables.                                                                                                                                               |
| Webhook verification          | Reject Stripe events that fail signature verification.                                                                                                                                                                               |
| Input validation              | Validate type, length, enum values and business rules server-side for every mutation.                                                                                                                                                |
| Rate limiting                 | Protect authentication-adjacent, recovery, activation, contact and sensitive write endpoints.                                                                                                                                        |
| Security headers              | Deploy CSP and appropriate HSTS, frame, MIME, referrer and permissions controls.                                                                                                                                                     |
| Audit logging                 | Record privileged changes and automated entitlement changes with enough data to reconstruct what happened.                                                                                                                           |
| Error handling                | Do not leak stack traces, secrets, database details or account existence to anonymous users.                                                                                                                                         |
| Backups                       | Enable and verify recoverable database backups appropriate to the production tier.                                                                                                                                                   |

# 3. Member data isolation objectives

Release 1 data-access functions resolve the actor from the server session, load server-managed active application-role grants, and then apply owner-or-administrator checks before private profile, role, membership, audit, or entitlement access. Registration and email-change verification store only a SHA-256 token digest. The raw random token exists only while the server constructs and sends the one-hour Mailchimp Transactional link; it is never returned in action state or persisted. Claiming a token is atomic, single-use, replay-safe, and invalidates earlier outstanding links for the account. Database triggers reject updates and deletes to audit and profile-change history.

- A normal member can read only their own private profile, membership, professional roles and approved payment summary.

- A normal member cannot write membership status, validity dates, payment records, administrator flags, or audit records. Members may update approved signup and professional fields only through the server-side validation/history workflow.

- Administrator access is not granted solely by a client-controlled profile column.

- Server-side administrative operations use trusted authorization and narrowly scoped database operations.

- Audit records are append-only to ordinary application roles.

# 4. Administrator security

- Require strong authentication for administrator accounts and enable MFA where supported/appropriate.

- Use least privilege: membership administrators should not automatically receive deployment, database or Stripe secret access.

- Every administrator action requires an audit entry. Sensitive actions such as suspending membership, changing paid-through dates, granting complimentary membership, deciding a refund consequence, merging identities or changing admin roles also require an explicit reason and before/after values where applicable.

- Do not expose migration/import tooling to normal authenticated users.

- Disable or remove temporary migration endpoints after cutover.

# 5. Account activation and enumeration

Public-facing activation/password-recovery requests should return neutral responses regardless of whether an email belongs to a member. Rate-limit requests and avoid exposing membership status before authentication.

# 6. Data minimization

- Store only the personal data required for IDOC membership operations.

- Do not copy irrelevant WordPress usermeta into the new platform.

- Do not store full payment card data; Stripe remains the PCI-scoped payment processor.

- Do not duplicate sensitive Stripe objects when identifiers and summarized billing state are sufficient.

- Define retention for migration exports and delete/safely archive temporary exports after acceptance.

# 7. Secure development and deployment

- Protect the production branch with pull-request review/checks appropriate to the project.

- Keep production and preview environment variables separated.

- Never use production Stripe secret keys in public/preview deployments that are accessible to untrusted code.

- Run dependency/security scanning and keep Next.js, Drizzle ORM/Kit, the PostgreSQL driver, the application authentication dependencies and the Stripe SDK current.

- Review Vercel build logs and source maps for accidental secret leakage.

- Use Vercel's platform protections as an additional layer, not as a replacement for application authorization.

# 8. Vercel Pro security and deployment controls

Vercel Pro strengthens the deployment perimeter and operations; it does not replace IDOC server-side authorization, database ownership checks, validation, or Stripe webhook verification.

| **Control** | **Approved IDOC use** | **When to implement** |
|---|---|---|
| Environment separation and protected previews | Separate Production, Staging/UAT and Preview values. Preview uses non-production data and Stripe test mode only; protect private feature previews. | Foundation |
| Firewall / WAF | Use managed protections plus narrowly scoped rate limits for auth, recovery, verification/resend, email changes, contact forms, Stripe webhooks and sensitive admin mutations. | Before public account and admin flows |
| Sensitive Environment Variables | Store production secrets as sensitive server-only values; never expose them in logs, browser responses, source maps or documentation. | Before entering production secrets |
| Observability and Runtime Logs | Investigate server errors, latency, failed background work and deployments without logging secrets or unnecessary personal data. | Before UAT |
| Cron Jobs | Use only as a scheduler for authenticated, idempotent, database-backed jobs. Record outcomes and prevent duplicate effects. | After the related workflows are complete |
| GitHub deployment integration | Preview each PR; deploy Production only from approved `main` merges. CI remains the merge gate. | Foundation |
| Fluid Compute | Keep default Vercel server execution; do not place long migrations/imports in requests. | Default |
| Workflows / Queues | Do not add initially. Re-evaluate only if Cron plus database-backed jobs cannot safely coordinate durable recovery, imports, delivery or wait lists. | When that trigger is reached |

## 8.1 Firewall and Cron verification

- Test normal member sign-in, verification, recovery, administrator operations, Stripe webhook delivery and preview access after material firewall changes.
- Every scheduled endpoint validates a server-only scheduler secret, is idempotent, writes durable safe run evidence, and alerts on repeated failures or missed expected runs.

# 9. Security acceptance checklist

| **Test**               | **Pass condition**                                                                                                                                                       |
|------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Cross-account read     | Member A cannot read Member B's private records even with crafted requests.                                                                                              |
| Cross-account write    | Member A cannot alter Member B or privileged fields on self.                                                                                                             |
| Role escalation        | No client request can assign administrator permissions.                                                                                                                  |
| Webhook forgery        | Invalid/missing Stripe signatures are rejected.                                                                                                                          |
| Webhook replay         | Duplicate event ID does not duplicate payment/entitlement effect.                                                                                                        |
| Secret exposure        | No server secret appears in browser source, network responses or public env variables.                                                                                   |
| SQL/data-access review | The database is not exposed directly to browsers; all server-side queries and mutations have reviewed ownership and role checks with no broad authenticated access path. |
| Enumeration            | Anonymous activation/recovery flow does not reveal membership existence.                                                                                                 |
| Admin audit            | Sensitive admin action produces immutable audit evidence.                                                                                                                |
| Backup restore         | Restore procedure has been tested or provider-supported recovery verified.                                                                                               |
| Protected preview      | A private PR preview cannot be accessed by an unapproved viewer and uses only non-production data and secrets.                                                          |
| Firewall/WAF           | Endpoint rules protect abuse paths without blocking legitimate traffic or verified Stripe webhooks.                                                                      |
| Scheduled jobs         | Each deployed job rejects unauthenticated invocation, is idempotent, records outcome and alerts on repeated failure.                                                    |

# 10. Official references

- Render: PostgreSQL documentation - https://render.com/docs/postgresql

- Drizzle ORM: Migrations - https://orm.drizzle.team/docs/migrations

- Stripe: Webhooks - [<u>https://docs.stripe.com/webhooks</u>](https://docs.stripe.com/webhooks)

- Vercel: Stripe Subscription Starter - [<u>https://vercel.com/templates/other/subscription-starter</u>](https://vercel.com/templates/other/subscription-starter)

- Vercel: Security - https://vercel.com/docs/security
- Vercel: Firewall - https://vercel.com/docs/vercel-firewall
- Vercel: Cron Jobs - https://vercel.com/docs/cron-jobs
- Vercel: Observability - https://vercel.com/docs/observability

## Release 1 recovery and account-state enforcement

Anonymous recovery and activation requests always return the same neutral response. Eligible accounts receive a Mailchimp Transactional message from `accounts@idoc.club`; delivery failure leaves the flow safely retryable through a fresh request. Raw tokens and passwords are neither persisted nor included in action state, audit payloads, logs, or redirects. Only the necessary inbound link carries the raw token. Successful reset increments the session version, invalidating existing signed sessions. Suspended and migrated-pending identities are rejected during authenticated-user resolution regardless of membership dates; expired members may authenticate only to the documented account-maintenance and future renewal/billing boundaries.
