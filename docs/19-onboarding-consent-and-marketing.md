# Onboarding consent and Mailchimp Marketing

This document governs the Release 1 onboarding consent behavior required by document 02 section 1.3 and the pending item recorded in document 08.

## Required onboarding consent

The demographics/profile onboarding submission requires two explicit acknowledgments:

- Terms of Service acceptance.
- Privacy Policy acceptance.

The browser disables submission until both are selected, but the server independently validates both acknowledgments. Consent is onboarding-only and is deliberately separate from the normal member profile schema so later self-service or administrator profile corrections never re-require acceptance.

Consent is persisted in `idoc.onboarding_consents`, one row per profile, in the same database transaction that creates the profile and completes onboarding. The row stores `terms_accepted_at`, `privacy_accepted_at`, and `keep_updated_opt_in`.

Migration `0019_onboarding_consents.sql` does not backfill existing profiles. A legacy/imported profile with no consent row therefore remains an unknown/unverified consent state; the migration must never fabricate acceptance timestamps or a marketing opt-in for a member who did not submit the new form.

## Optional marketing opt-in

"Keep me updated" is optional and selected by default in the onboarding UI. It controls only IDOC promotional/event/workshop/certification messaging through Mailchimp Marketing. It does not suppress mandatory account, security, membership, payment, renewal, or other operational messages delivered through the separate Mailchimp Transactional integration.

When a newly onboarded member opts in, IDOC performs a best-effort Mailchimp Marketing audience update after the profile transaction commits. The request:

- uses the member's normalized email address;
- uses Mailchimp's member hash endpoint;
- sends `status: "subscribed"`, so fresh explicit consent can restore an existing audience member that was previously pending or unsubscribed;
- is bounded by a five-second abort timeout;
- never rolls back or invalidates completed onboarding when Mailchimp Marketing is missing, misconfigured, unavailable, or returns an error;
- logs only categorical failure information and never logs credentials.

## Runtime configuration

Mailchimp Marketing is a separate product and credential boundary from Mailchimp Transactional. The server-only environment variables are:

- `MAILCHIMP_MARKETING_API_KEY` — Mailchimp Marketing API key including its datacenter suffix, for example `...-us21`.
- `MAILCHIMP_AUDIENCE_ID` — target audience/list ID.

Missing or invalid Marketing configuration causes the optional audience subscription to be skipped without affecting onboarding. These variables do not replace `MAILCHIMP_TRANSACTIONAL_API_KEY` and are not part of payment or Stripe configuration.

## Payment isolation

This functionality does not change Stripe, checkout, subscriptions, prices, renewals, payment webhooks, imported Stripe relationships, membership entitlement, or billing behavior.
