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
| Authentication                | Use the application's authentication system with verified email flows, secure session handling and documented account-lifecycle controls.                                                                                            |
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

- A normal member can read only their own private profile, membership, professional roles and approved payment summary.

- A normal member cannot write membership status, validity dates, professional verification fields, payment records, role/level fields requiring administrator approval, or administrator flags.

- Administrator access is not granted solely by a client-controlled profile column.

- Server-side administrative operations use trusted authorization and narrowly scoped database operations.

- Audit records are append-only to ordinary application roles.

# 4. Administrator security

- Require strong authentication for administrator accounts and enable MFA where supported/appropriate.

- Use least privilege: membership administrators should not automatically receive deployment, database or Stripe secret access.

- High-risk actions such as suspending membership, changing paid-through dates substantially, merging identities or changing admin roles require explicit reason and audit entry.

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

# 8. Security acceptance checklist

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

# 9. Official references

- Render: PostgreSQL documentation - https://render.com/docs/postgresql

- Drizzle ORM: Migrations - https://orm.drizzle.team/docs/migrations

- Stripe: Webhooks - [<u>https://docs.stripe.com/webhooks</u>](https://docs.stripe.com/webhooks)

- Vercel: Stripe Subscription Starter - [<u>https://vercel.com/templates/other/subscription-starter</u>](https://vercel.com/templates/other/subscription-starter)
