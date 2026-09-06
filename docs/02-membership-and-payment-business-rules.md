**IDOC**

**Membership & Payment Business Rules**

Rules needed to keep membership entitlement correct across Stripe and non-Stripe payments

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.2                                            |
| **Date**             | 2 September 2026                              |

Working project document. Update this document when project decisions change.

# 1. Membership types

| **Type**        | **Stored representation**                 | **Billing difference** |
|-----------------|-------------------------------------------|------------------------|
| Judge           | Judge role + judge level                  | None                   |
| Steward         | Steward role + steward level              | None                   |
| Judge + Steward | Two role records, each with its own level | None                   |
| Veterinarian    | Veterinarian role                         | None                   |

## 1.1 Approved signup field dictionary

All fields listed below are required unless marked optional. Email is also the member's username. Country and National Federation must use the same canonical, complete country list throughout signup, account administration, migration, and reporting.

### Every member

- Email
- First Name
- Last Name
- Address 1
- Address 2 (optional)
- City
- State/Province
- Zip
- Country

### Judge, Steward, and Judge + Steward

- National Federation
- IDOC Region, limited to:
  - Western Europe & Africa
  - Central & Eastern Europe
  - Asia
  - North America
  - Central & Latin America
  - Pacific
- FEI ID (optional)

### Judge

- Official Status as Judge, limited to:
  - FEI Dressage Judge 1/2\*\*
  - FEI Dressage Judge 2/3\*
  - FEI Dressage Judge 3/4\*
  - FEI Dressage Judge 4/5\*\*
  - National Senior Officials / Candidates from EEFs education system FEI
  - Para Dressage Judge
  - Retired Official
  - Other
- Are you a Technical Delegate: Yes or No

### Steward

- Official Status as Steward, limited to:
  - FEI Dressage Steward Level 1
  - FEI Dressage Steward Level 2
  - FEI Dressage Steward Level 3/4
  - National Dressage Steward
  - FEI Para Dressage Steward
  - Other

### Judge + Steward

The combined signup choice requires all common official fields, the complete Judge section, and the complete Steward section. It is stored as active Judge and Steward role records rather than a permanent combined role.

### Veterinarian

Veterinarians have only the fields required for every member. They do not receive the National Federation, IDOC Region, FEI ID, Judge-status, Steward-status, or Technical Delegate fields unless their professional classification later changes.

## 1.2 Account creation, login, and password-reset flow

### Account creation

1. Member enters an email address and submits.
2. If the email has no existing account, the system emails a 6-digit verification code.
3. Member enters the code. Once verified, the member sets a password. No `users` row — and therefore no account — exists before this point, so an abandoned attempt never leaves an orphaned, passwordless account behind; the row is created directly in an unverified-until-this-point state that requires the code before proceeding.
4. Password set, the member reaches onboarding for demographic and member-type-specific information (§1.1) and the required consent checkboxes (§1.3).
5. On successful onboarding submission: if the "Keep me updated" checkbox (§1.3) was checked, the member is added to the Mailchimp Marketing events/workshops/certifications audience; the member is then sent to the membership-payment page (§2), not to the member dashboard. Payment cannot be deferred into ordinary dashboard access.
6. After a successful payment, the member is sent to the dashboard.
7. If the email already has an account, no code is sent. Instead the system emails that address a notice that an account already exists, with a link to the login page, and the signup attempt does not proceed to account creation.
8. Administrators and Super Admins are never self-service-created; the sole Super Admin invites administrators via invitation link. No signup flow exists for either role.

### Login

1. Member enters email and submits.
2. The flow locks to that email for the password step (with a visible "use a different email" escape hatch), regardless of whether the email has an account — unlike account creation and password reset, this step does not stay neutral about account existence, matching the ordinary email-first login pattern.
3. Member enters password.
4. If the current device is already trusted (§ device-trust cookie, docs/05), authentication completes and the server routes the account according to its current membership entitlement: paid/grace members reach the dashboard; never-paid and post-grace expired accounts reach the membership-payment gate.
5. If the device is not trusted, the system emails a 6-digit verification code (distinct in purpose from the account-creation code — see docs/05's OTP-purpose binding requirement). This code-entry screen includes a "Remember me for 2 weeks" checkbox. Checking it issues a secure, `httpOnly` cookie containing a random opaque credential whose keyed digest is stored in the revocable trusted-device registry; it lets this device skip the login verification code on the same device for the same account for 2 weeks; leaving it unchecked means the device is not remembered and the next login on that device verifies again. This mechanism is unrelated to the account-creation email-verification code.
6. Successful code entry routes the account according to the same current membership-entitlement rule; successful authentication never grants unpaid dashboard access.
7. Administrators and Super Admins follow the same flow, except the second factor is always an authenticator-app TOTP code (registering one first if none is registered yet) instead of an emailed 6-digit code, and there is no "remember me" option for privileged accounts — every login re-verifies the second factor.

### Password reset

1. Member enters email and submits. This step stays neutral about account existence (unlike login), matching the account-creation and anonymous-recovery pattern documented in docs/05.
2. The system emails a 6-digit verification code.
3. Member is sent to the code-entry page. An unsuccessful attempt shows a plain "that code was incorrect" message.
4. A successful code entry sends the member to a new-password page.
5. Member sets a new password.
6. Member is routed according to current membership entitlement; password reset does not bypass the payment gate.
7. Administrators and Super Admins follow the same flow, except the code step is their already-registered authenticator-app TOTP code instead of an emailed 6-digit code (a privileged account is expected to already have TOTP registered by this point, since login always requires it).

## 1.3 Required consent (onboarding/demographics form)

The demographics/onboarding form (§1.1) gates its submit action on two required checkboxes, plus one optional checkbox that is checked by default:

- **Required** — "I have read and agree to the Terms Of Service and acknowledge that IDOC membership costs €80 for 12 months. I will choose at payment whether to renew automatically each year, and I may change that renewal choice later in Billing Settings."
- **Required** — "This site collects names, emails and other user information. I consent to the terms set forth in the Privacy Policy."
- **Optional, checked by default** — "Keep me updated on IDOC events, workshops, and certifications" (if left unchecked, the member still receives account-standing, payment, security, and renewal messages per §11 — they only miss event/workshop/certification communications). Checking this subscribes the member to the corresponding Mailchimp Marketing audience; leaving it unchecked (or later opting out) does not affect the account-standing/payment/security/renewal messages members cannot opt out of.

# 2. Pricing

Standard annual membership fee: €80 for 12 months. Professional role and level do not determine price. Members see one IDOC Annual Membership, not separate products, plans, tiers, or pricing cards for automatic renewal and one-time payment. Automatic renewal is a billing preference attached to that one membership.

Stripe should use one canonical IDOC membership Product for new enrollments. Recurring and non-recurring billing require distinct Stripe Price configurations, but that technical distinction is not presented as two member-facing products. Migrated subscriptions may retain their existing Product and Price IDs.

# 3. Membership entitlement rules

- Membership entitlement is represented by the IDOC membership record.

- A successful eligible payment may create or extend entitlement. An administrator may also grant or extend entitlement through the approved manual-payment/adjustment workflow.

- Creating an authenticated user account or completing onboarding does not create membership entitlement. A never-paid account is an applicant/account holder, not an active member.

- A never-paid account and a previously paid account whose five-day grace period has ended may access only the membership-payment experience and logout after authentication. They cannot access dashboard navigation, profile, security, payment history, member content, professional-role content, or any other member-only read or mutation.

- Payment-only access must be enforced at every server-rendered page, Route Handler, Server Action, and data-access boundary. Hiding dashboard navigation is not authorization.

- Canceling auto-renewal does not necessarily terminate access immediately; access normally continues through the paid-through date.

- A failed recurring payment or the end of a non-recurring paid term follows the same approved five-calendar-day grace-period rule rather than immediately removing member access.

- Suspension is an administrative state that can override a paid-through date.

- Professional level changes do not reset or alter the paid-through date.

# 4. Payment sources

| **Source**             | **Automation**                   | **Required stored evidence**                                                  |
|------------------------|----------------------------------|-------------------------------------------------------------------------------|
| Stripe recurring       | Webhook-driven                   | Customer ID, Subscription ID, invoice/payment identifiers, status, period end |
| Stripe one-time        | Required webhook-driven flow     | Customer/payment identifier, amount, paid date, Checkout Session and one-time Price ID |
| PayPal                 | Manual                           | Transaction/reference, paid date, amount, administrator                       |
| Bank transfer          | Manual                           | Reference, paid date, amount, administrator                                   |
| Cash / in person       | Manual                           | Receipt/reference if available, paid date, amount, administrator              |
| Complimentary          | Manual administrator action      | Reason, approver, effective dates                                             |

# 5. Renewal logic

IDOC uses a rolling 12-month membership calendar. It does not use a common annual expiration date.

- A new paid membership begins on its successful payment/effective date and runs for 12 months.

- Each migrated member retains the person's existing paid-through/expiration date. Migration must not replace individual dates with a shared anniversary or recalculate them merely because the member is moving systems.

- Stripe and manual-payment workflows must use the same rolling-calendar policy.

- An early renewal adds 12 months to the current paid-through date. The member never loses the unused part of an active term.

- A renewal paid after membership has expired starts a new 12-month term on its actual successful payment date.

- A manual payment entered after the fact uses its actual payment date. If that date was before expiration, it follows the early-renewal rule; if it was after expiration, it starts a new 12-month term from that date.

- A normal manual payment is €80 and grants 12 months. All manual payments are in EUR. No discounted, partial, or waived paid memberships are allowed.

- Any administrator may grant a complimentary membership. It must have a reason, granted term, actor and full audit entry.

- Administrators may set or correct a paid-through date to reflect the real payment date or a justified entitlement correction. This is an audited override and must require a reason.

# 5.1 Online renewal choice, notices and failed payments

- The first payment page presents one IDOC Annual Membership at €80 for 12 months and one renewal control. It must not use two pricing cards or describe automatic renewal and one-time payment as different products, plans, membership types, or prices.

- Automatic annual renewal is selected by default. The member may turn it off before the first payment. With automatic renewal on, Checkout uses subscription mode; with it off, Checkout uses payment mode. Both grant exactly the same 12-month membership entitlement after verified payment.

- The server grants membership only after a verified, idempotent successful-payment webhook tied to the authenticated IDOC account and the expected membership Product, amount, currency, and billing mode. A completed browser redirect is never evidence of payment. A one-time payment creates no Stripe subscription.

- Billing Settings presents automatic renewal as a changeable preference for the one membership. A member may switch it on or off at any time. A change takes effect at the next paid-through/renewal date, never immediately, never shortens paid time, and never creates a duplicate charge or subscription.

- Switching automatic renewal off sets the existing Stripe subscription to cancel at period end. Access continues through the paid-through date and the following five-day grace period if no renewal payment is received.

- Switching automatic renewal on for a non-recurring member collects and stores payment authorization without charging immediately, then schedules annual €80 billing to begin on the current paid-through date. The member may reverse a pending change before it becomes effective. Repeated or concurrent requests must be idempotent and must not create duplicate Customers, payment methods, schedules, or subscriptions.

- Billing Settings shows the membership amount, paid-through date, current renewal preference, any pending change, its effective date, and the next expected charge. Stripe Customer Portal may manage payment methods and invoices, but IDOC owns the membership-specific automatic-renewal preference and transition workflow.

- Send an automatic-renewal notice 15 days before the scheduled renewal date.

- Send a non-auto-renewal expiration notice 30 days before the paid-through date.

- On an automatic-renewal failure, Stripe retries automatically and the five-calendar-day grace window begins on the failed scheduled-renewal date. For a non-recurring term, `valid_until` remains fully entitled through that date and the five full calendar days of grace begin on the following calendar day. In either case, the previously paid person remains a full member throughout the applicable grace window. If no eligible payment is received by its end, membership becomes expired and the account is restricted to payment and logout.

- An expired member retains the account and its history but, after grace ends, receives only the membership-payment gate and logout after login. Payment reactivates access only after the verified/idempotent payment path updates membership entitlement. Administrator and Super Admin access remains governed by application-role policy rather than a self-service member-payment gate.

# 6. Stripe subscription status mapping

| **Stripe state/event**                   | **Recommended IDOC action**                                                                                      |
|------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| invoice.paid                             | Record payment; extend/confirm entitlement according to renewal policy.                                          |
| invoice.payment_failed                   | Record billing problem; enter grace state if policy allows; notify member.                                       |
| customer.subscription.updated            | Refresh local subscription metadata; do not blindly alter membership without interpreting status and period end. |
| customer.subscription.deleted            | Mark subscription ended; preserve membership until valid_until unless administratively overridden.               |
| Subscription cancel_at_period_end = true | Show non-renewing status; retain entitlement through paid-through date.                                          |

# 7. Member account and profile changes

The Release 1 persistence workflow closes the current professional-role rows and inserts newly validated rows instead of overwriting role history. The profile update, role history, profile-change history, audit entry, and administrator-notification outbox entry are committed in one database transaction. Notification delivery through Brevo Transactional remains Release 2 scope.

- A currently paid or grace-period member may update every signup/profile field, including professional classification, National Federation, IDOC Region, FEI ID, official status and Technical Delegate answer. A never-paid or post-grace expired account cannot reach these member-profile capabilities until payment restores entitlement.

- The system validates the fields required by the resulting classification before saving. A Judge + Steward must always retain the required fields for both active roles.

- Every member-initiated profile or classification change creates history visible only to administrators and notifies administrators. Member changes do not alter billing or membership dates.

- One normalized email address belongs to one account only. A member may change the email/username only after verifying the new address. The existing Stripe Customer email is then updated server-side; Stripe Customer and Subscription IDs, not email, preserve the billing relationship.

# 8. Administrator rules for manual payments and membership actions

1. Administrator finds the existing member rather than creating a duplicate.

2. Administrator records payment source, amount, currency, paid date and reference.

3. System calculates the proposed new valid-through date using the approved renewal rule.

4. Administrator confirms the result.

5. System writes the payment, membership change and audit entry in one transaction.

6. Any manual payment, complementary grant, paid-through correction, suspension, refund decision or other administrator action requires a reason and audit entry.

7. Administrators have full application access. Super Admin has all administrator access plus restricted application settings and functions reserved for the project owner.

8. A manual suspension blocks member access regardless of paid-through date. It is distinct from a payment-only account and must not be lifted merely by a new payment; reinstatement is a separate audited administrator action.

9. A refund never automatically changes entitlement. The administrator deciding the refund must choose and record its membership consequence.

# 9. Duplicate prevention

- Use normalized email, legacy WordPress user ID and external billing identifiers during migration matching.

- Do not create a new member merely because a Stripe Customer has a different email; place ambiguous matches in review.

- Do not attach one Stripe Subscription to more than one profile.

- Provide an administrator merge workflow or migration-only merge tool for verified duplicates.

# 10. Member-facing wording requirement

Existing migrated users should encounter an account-access/activation flow, not language suggesting they must purchase or create a new membership. Their existing entitlement and billing relationship must already exist before they first log in.

# 11. Communications

- Use Brevo Transactional for application notifications, from accounts@idoc.club.

- Members may opt out of event notifications and marketing email. They may not opt out of account-standing, payment, security, renewal, expiration, or other messages necessary to operate their account.

# 12. Content, seminars and publishing

- CMS content may be public or assigned through a checklist to active-member, Judge, Steward and Veterinarian classifications. Every restricted item must explicitly use either Match any selected classifications (union) or Match all selected classifications (intersection); an administrator cannot rely on an implied default. Administrators can view every published item. An expired member sees only public content.

- Each seminar may be public or assigned through the same explicit Match any selected classifications or Match all selected classifications rule as CMS. It may offer a distinct price, including free, to public registrants, each classification, or a combination of classifications. When a registrant qualifies for multiple prices, the system applies the lowest eligible price and shows the basis before payment. Each seminar independently enables guest registration, manual payments, capacity limits, waitlists, cancellation and refunds as applicable.

- Each seminar has an administrator-defined cancellation/refund policy that is shown before registration/payment.

- Administrators may publish news and blog posts; the president is an administrator.
