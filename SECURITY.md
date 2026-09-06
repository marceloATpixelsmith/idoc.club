# Security Policy

IDOC (International Dressage Officials Club) takes the security of member accounts and data
seriously.

## Reporting a vulnerability

If you believe you've found a security vulnerability in this application or its infrastructure,
please report it privately rather than opening a public GitHub issue.

- **Email:** the address published at [`/.well-known/security.txt`](https://idoc.club/.well-known/security.txt)
  on the live site (kept in sync with `IDOC_ADMIN_NOTIFICATION_EMAIL`; see `docs/07-administrator-and-operations-runbook.md` §15).
- **What to include:** the affected URL/endpoint, the steps to reproduce, and the impact you believe
  the issue has. A proof-of-concept is welcome but never test against real member accounts or data
  you do not own.

## What to expect

We will acknowledge a report and keep you informed as we investigate and, where applicable, remediate
the issue. We ask that you give us a reasonable window to address a confirmed issue before any public
disclosure, and that you avoid actions that could degrade the service or expose other members' data
while investigating (no automated scanning at volume, no data exfiltration beyond what's needed to
demonstrate the issue).

## Scope

This covers the IDOC web application and its first-party infrastructure. Third-party providers we
integrate with (Google, Cloudflare Turnstile, Stripe, Brevo) have their own security reporting
channels and are out of scope here.

## Current posture

For context on what's already implemented, see `docs/21-authentication-security-control-inventory.md`
(the authoritative control-by-control inventory) and `docs/20-authentication-security-test-acceptance.md`
(what's automatically verified). Neither of those documents, nor this policy, constitutes a claim of
penetration-test certification.

## Release-evidence boundary

Repository security checks include a blocking high-severity dependency audit and behavioral authentication tests. They do not constitute production sign-off. The authoritative checklist currently preserves eight previously recorded operator-verification entries while fresh step-up/session/role invalidation and the production smoke test remain unchecked; the repository must not manufacture those two manual results.
