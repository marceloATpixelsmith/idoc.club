# IDOC project documentation

These Markdown files are the authoritative project documentation for the IDOC platform. Word and PDF copies are exports only and must not be edited as the source of truth.

## Reading and implementation order

1. [Project Charter and Scope](00-project-charter-and-scope.md)
2. [Solution Architecture and Data Model](01-solution-architecture-and-data-model.md)
3. [Membership and Payment Business Rules](02-membership-and-payment-business-rules.md)
4. [Legacy Data Migration and Reconciliation Plan](03-legacy-data-migration-and-reconciliation-plan.md)
5. [Stripe Subscription Preservation and Billing](04-stripe-subscription-preservation-and-billing.md)
6. [Security and Privacy Requirements](05-security-and-privacy-requirements.md)
7. [Implementation, Testing, and Cutover Plan](06-implementation-testing-and-cutover-plan.md)
8. [Administrator and Operations Runbook](07-administrator-and-operations-runbook.md)
9. [Product Roadmap and Functional Requirements](08-product-roadmap-and-functional-requirements.md)
10. [Codex Working Rules](09-codex-working-rules.md)

Start with document 08 when planning the next development phase, then consult the subject document that governs the affected behavior. Every Codex implementation prompt must also follow document 09.

## Document ownership

| Subject | Governing document |
|---|---|
| Product boundaries and success criteria | 00 |
| Architecture, database, data model, and authorization | 01 |
| Membership, signup fields, pricing, entitlement, renewal, and manual-payment rules | 02 |
| WordPress Multisite and MemberPress migration | 03 |
| Stripe preservation, webhooks, Portal, and reconciliation | 04 |
| Security, privacy, hardening, and acceptance controls | 05 |
| Delivery phases, testing, rehearsal, cutover, and rollback | 06 |
| Administrator procedures and ongoing operations | 07 |
| Functional scope, release order, and requirement traceability | 08 |
| Mandatory Codex implementation, security, test, and reporting rules | 09 |

## Maintenance rule

Any code change that affects membership rules, fields, data structures, authorization, security, billing, migration, notifications, administration, operations, CMS access, seminars, news, or publishing must update the governing Markdown document in the same pull request.

Unresolved items must be labeled `Decision required`. Once IDOC approves a decision, replace that marker with the approved rule and update every dependent document in the same pull request. The current approved policy set is recorded in document 02 and reflected in document 08.

Do not add generated Word or PDF exports to this directory unless a release process explicitly requires them.
