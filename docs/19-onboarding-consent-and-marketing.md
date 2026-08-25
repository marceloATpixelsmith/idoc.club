# Onboarding consent and marketing

## Implemented behavior

New members must explicitly accept the Terms of Service and Privacy Policy when they submit onboarding. "Keep me updated" is optional and checked by default. Server-side validation rejects missing required acceptance regardless of browser validation.

The profile, roles, consent evidence, audit evidence, and account-state transition commit in one PostgreSQL transaction. `idoc.onboarding_consents` is a one-to-one child of the newly created profile and records the actual submission time for both required acceptances plus the submitted marketing choice. Migration `0019_onboarding_consents` does not backfill the table: imported or otherwise existing profiles without real submission evidence remain without a consent row.

After an opted-in onboarding transaction commits, the server makes a best-effort Mailchimp Marketing add-or-update request. It sends both `status` and `status_if_new` as `subscribed`, allowing a new member to be created and a previously pending or unsubscribed member to be resubscribed from fresh explicit consent. The request has a five-second timeout. Missing configuration, provider rejection, network failure, or timeout cannot roll back onboarding and has no Stripe, payment, billing, entitlement, or subscription effect.

## Runtime configuration

The server-only integration uses `MAILCHIMP_MARKETING_API_KEY`, `MAILCHIMP_MARKETING_SERVER_PREFIX`, and `MAILCHIMP_MARKETING_AUDIENCE_ID`. If any value is absent, onboarding still completes and no provider call is attempted. These values must never be exposed to browser code or persisted as consent evidence.
