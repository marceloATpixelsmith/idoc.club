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

## Current staging alignment — 3 October 2026

This remains the governing business-rules document for membership. For the implemented cross-domain contract tying authentication, membership billing/access, and seminar registration together, also read [document 28](28-auth-membership-seminar-current-state.md).

- Current ordinary-member sessions use a 7-day idle timeout and a 14-day absolute lifetime; privileged sessions use a 30-minute idle timeout and a 12-hour absolute lifetime. Ordinary-member returning-login device trust lasts 14 days and is separate from privileged TOTP.
- Membership entitlement remains webhook-authoritative. Turning automatic renewal on for an existing non-recurring member uses Stripe Checkout in setup mode and makes the recurring transition effective on the current `valid_until`; turning it off uses `cancel_at_period_end`.
- Seminar registration and seminar payments are a separate domain. An entitled profile receives the seminar member price; a signed-in profile without current entitlement and an anonymous guest receive the non-member price. No seminar payment may create or extend membership entitlement.

If older narrative in this document conflicts with this current-state subsection or document 28, this current-state subsection governs until the older passage is repaired.

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
4. Password set, the member reaches My Membership inside the dashboard for demographic and member-type-specific information (§1.1) and the required consent checkboxes (§1.3). No other dashboard section is available yet. A valid `membership` signup parameter preselects and emphasizes the matching Judge, Steward, Judge + Steward, or Veterinarian option but remains editable.
5. On successful onboarding submission: if the "Keep me updated" checkbox (§1.3) was checked, the member is added to the Mailchimp Marketing events/workshops/certifications audience; the member is then sent directly to the membership-payment page (§2). Payment cannot be deferred into ordinary dashboard access.
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

- The dedicated **Extend Expiration Date** action accepts only a real calendar date on or after the current paid-through date and requires an administrator reason. It changes only the current membership's paid-through date under the membership lock, records previous/new dates and actor/reason, and treats an equal-date retry as already complete. It never creates a payment or changes Stripe billing dates. Shortening or status repair belongs in the broader entitlement-correction tool.

# 5.1 Online renewal choice, notices and failed payments

- The first payment page presents one IDOC Annual Membership at €80 for 12 months and one renewal control. It must not use two pricing cards or describe automatic renewal and one-time payment as different products, plans, membership types, or prices.

- Automatic annual renewal is selected by default. The member may turn it off before the first payment. With automatic renewal on, Checkout uses subscription mode; with it off, Checkout uses payment mode. Both grant exactly the same 12-month membership entitlement after verified payment.

- The server grants membership only after a verified, idempotent successful-payment webhook tied to the authenticated IDOC account and the expected membership Product, amount, currency, and billing mode. A completed browser redirect is never evidence of payment. A one-time payment creates no Stripe subscription.

- Billing Settings presents automatic renewal as a changeable preference for the one membership. A member may switch it on or off at any time. A change takes effect at the next paid-through/renewal date, never immediately, never shortens paid time, and never creates a duplicate charge or subscription.

- Switching automatic renewal off sets the existing Stripe subscription to cancel at period end. Access continues through the paid-through date and the following five-day grace period if no renewal payment is received.

- Switching automatic renewal on for a non-recurring member collects and stores payment authorization without charging immediately, then schedules annual €80 billing to begin on the current paid-through date. The member may reverse a pending change before it becomes effective. Repeated or concurrent requests must be idempotent and must not create duplicate Customers, payment methods, schedules, or subscriptions.

- Billing Settings shows the membership amount, the Renewal Date (the paid-through date -- the day the membership needs to be renewed by), and the current renewal preference as a single Automatic/Manual choice with any pending change and its effective date, plus a plain-language line under the radio group stating what the selected mode means ("Your membership will automatically renew on {date}" for Automatic, "Your membership will expire on {date}" for Manual). A separate "Payment Method" box next to the Membership box on the same My Membership page shows the card on file and lets the member update it (a Stripe-hosted form is still used for entering card details, but it returns to the My Membership page rather than a general Stripe portal). Stripe Customer Portal, where reached from that box, is scoped to payment-method updates only -- never invoice history or subscription cancellation -- so IDOC's own dashboard remains the one place recurrence and cancellation are tracked.

- **Self-service cancellation** is a distinct action from turning automatic renewal off, and the two must never be conflated in the UI or in code. Turning automatic renewal to Manual only stops future billing; the membership stays active and entitled through the existing paid-through date. Cancellation, reached from its own explicit "Cancel membership" control with a confirmation naming its consequences, ends access **immediately** regardless of any remaining paid time: the membership status becomes `suspended` -- the same status/access semantics an administrator's suspension already uses (denies access regardless of paid-through date, without moving `valid_until`), distinguished in the audit trail only by its own `member.membership_canceled` action rather than `admin.membership.suspended` -- any open Stripe subscription is canceled immediately (not at-period-end), the member is removed from the marketing mailing list, and every session and remembered device is revoked, signing the member out. A Stripe event already in flight at the moment of cancellation (a renewal payment or a failure notice for the just-canceled subscription) must never silently restore entitlement: `handleInvoicePaid`/`handleInvoicePaymentFailed` check for `suspended` first and leave it alone, recording a `status_conflict` reconciliation finding instead if money already changed hands. It does not delete the member's account or login credentials (that remains the separate, more severe Delete Account action under Security) -- a canceled member can sign back in later, but (like any other non-entitled member) is sent to My Membership at `/dashboard/membership`, where the payment controls are shown instead of ordinary entitled-member dashboard content.

- Send an automatic-renewal notice 15 days before the scheduled renewal date.

- Send a non-auto-renewal expiration notice 30 days before the paid-through date.

- On an automatic-renewal failure, Stripe retries automatically and the five-calendar-day grace window begins on the failed scheduled-renewal date. For a non-recurring term, `valid_until` remains fully entitled through that date and the five full calendar days of grace begin on the following calendar day. In either case, the previously paid person remains a full member throughout the applicable grace window. If no eligible payment is received by its end, membership becomes expired and the account is restricted to payment and logout.

`valid_until` remains the paid-through date. The separate `grace_ends_on` is the inclusive last day
of grace: an automatic failure on D is entitled D through D+4, while a non-recurring term ending on
D is entitled in grace D+1 through D+5. A failure therefore never appears to extend paid time.

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

10. An administrator classification change reuses canonical profile validation and professional-role history: valid targets are Judge, Steward, Judge + Steward, and Veterinarian, with all target-specific fields required. The change requires a reason and audit before/after evidence, and does not alter payment history, membership expiration, or Stripe Product, Price, subscription, or renewal state.

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

## 11.1 Transactional email presentation

All user-facing transactional emails sent through Brevo use the shared IDOC email presentation layer unless a message has a deliberately richer, purpose-specific body. The shared presentation uses the white IDOC logo, the site's dark-blue email background/card palette, IDOC gold headings and accents, white body text, and Barlow as the preferred typeface with email-safe fallbacks. Shared gold CTA buttons use one canonical pill-shaped rounded treatment with Barlow typography and uppercase labels. Decorative icons or arrows are not part of the default shared button and are added only when a specific email design calls for them.

Authentication, account-access, and account-security notices use the shared branded shell with concise purpose-specific content.

Membership and billing notices use the same shared shell plus a more explicit transactional layout: plain-language explanation of why the message was sent, a compact status/details card using IDOC-gold icons where appropriate, the relevant renewal/expiration/grace/payment state, and a clear next action when action is available. The governed member-facing notices are the automatic-renewal reminder, non-renewing expiration reminder, renewal-payment failure, grace-period reminder, and post-grace membership-expired notice.

Seminar registration confirmations retain their detailed seminar-specific branded layout. Seminar cancellation, seminar payment confirmation, and seminar refund confirmation use the shared branded presentation with status/payment/refund detail cards and explanatory transactional copy. These seminar status messages must remain suitable for both account holders and guest registrants; they must not require a member-dashboard CTA in order to understand or act on the message.

The shared renderer and shared presentation helpers are the canonical source for common transactional-email branding so future brand changes cascade across email types instead of being reimplemented separately.

# 12. Content, seminars and publishing

## 12.1 Administrator-created seminar registrations

Administrators may create seminar registrations directly from the Registrations table using the same drawer-based admin workflow as other record creation. An administrator-created registration accepts only currently enabled offline seminar payment methods: **Bank Transfer** or **Cash**. Online/Stripe payment is never available for an administrator-created registration.

The entered email is used only to determine whether the registration belongs to an existing IDOC profile. If a matching profile exists, the registration remains profile-backed even when that profile is lapsed, suspended, or otherwise not currently entitled. **Current membership entitlement, not profile existence, determines price:** an entitled profile receives the member seminar price; a non-entitled profile receives the non-member seminar price. If no matching profile exists, the registration is stored as a guest registration at the non-member price.

The same duplicate/reactivation, capacity, deadline, payment-state, audit, and confirmation-notification rules used by normal registrations apply. Successful admin creation records the administrator actor in the audit log and queues the same branded seminar confirmation appropriate to the selected offline payment method.



- CMS content may be public or assigned through a checklist to active-member, Judge, Steward and Veterinarian classifications. Every restricted item must explicitly use either Match any selected classifications (union) or Match all selected classifications (intersection); an administrator cannot rely on an implied default. Administrators can view every published item. An expired member sees only public content.

- **Implemented seminar slice:** administrators create and edit date-only seminars with start/end calendar dates, language, organizing National Federation, capacity, pricing, deadline, status, and five sanitized rich-text information sections. Seminars contain no time-of-day or timezone. The payment method remains chosen per registration, prices remain immutable after registration, and registration/payment state remain independent.

  - Every seminar has its own public detail page (`/seminars/[id]`), linked from every listing card, using the site's full fixed-width layout, left-aligned like every other page. The listing's icon-block information (date, location, member/non-member prices, Levels if any, registration deadline, and the FEI badge if flagged) leads; the seminar's own free-text description follows in a separate box, since that is what a visitor came to the page to find first. A single full-width "Register" button, matching the width of that information box, replaces a separate registration box. For a signed-in visitor (a currently entitled member, a signed-in profile owner without member pricing, or a signed-in visitor with no profile at all), clicking it continues through the same registration dialog; manual-payment selection opens the guest contact form inside that dialog. A signed-out visitor instead sees a branded dialog with two explicit choices: join IDOC (to unlock the member price), or continue as an anonymous guest at the non-member price with no account required -- member/profile-owner paths remain locked to their account identity. A true guest choosing Online Payment does not see an IDOC contact form: Stripe Checkout collects first name, last name, email, and phone, and the verified paid webhook creates the registration only after rechecking seminar state, deadline, capacity, amount, currency, and duplicate email. If a paid Checkout can no longer become a valid registration, the system attempts an idempotent refund and records reconciliation evidence when needed. A guest choosing Bank Transfer or Cash uses the IDOC contact form because Stripe is not involved; that form collects first name, last name, email, and international phone. A signed-in visitor with their own member profile (a lapsed membership, most commonly) gets profile-backed registration at the non-member price, so it appears in their own My Seminars and can be canceled normally. Only a signed-in visitor with no member profile at all uses the true guest mechanism. Guest registrations are deduplicated per seminar by case-insensitive email. All successful seminar registrations use the durable notification outbox and the shared branded confirmation renderer; offline confirmations queue at registration creation, while Online confirmations queue only after verified paid webhook processing. Anonymous write paths retain CSRF, Turnstile, validation, and rate limiting; the Stripe-first online path uses origin-scoped limiting because IDOC deliberately has no guest email before Checkout. See [01 Solution Architecture and Data Model](01-solution-architecture-and-data-model.md) and [07 Administrator and Operations Runbook](07-administrator-and-operations-runbook.md#seminar-operations) for full detail.
  - An administrator's manual bank-transfer/cash payment record is refused while a registration still has an open Stripe Checkout Session, so a registrant cannot complete that session after being marked paid and be charged a second time with no local record to refund. Reactivating a registration an administrator or the registrant previously canceled re-runs the same seminar open/deadline/capacity gate a brand-new registration goes through, rather than skipping it.
  - The Available Seminars catalog (member-scoped and the signed-out public catalog alike) is one flat list -- an open, full, or registration-closed seminar all appear together with a small status tag, never split into a separately-headed section -- followed by a "Past seminars" archive of already-ended, published seminars, so a visitor can see what IDOC has actually run. Every card links to the seminar's own detail page.
  - An administrator may flag a seminar as FEI-affiliated (a simple toggle in the seminar form). The flag is purely a display badge -- the FEI logo appears small on that seminar's listing cards and larger on its detail page -- and carries no eligibility, pricing, or workflow logic of its own.
  - An administrator may assign a seminar one or more Levels (Level 1/Level 2/Level 3), or the single special value All Levels -- checking All Levels always discards any individually-checked level. This is purely a display attribute, shown on the detail page's icon-block list directly above the FEI badge, and carries no eligibility, pricing, or workflow logic of its own.

- **Deferred to a later iteration:** the audience-eligibility system described below (Match any/Match all classification targeting, shared with CMS), tiered pricing per classification or combination beyond the implemented member/non-member split, waitlists, and administrator-defined cancellation/refund policies. These remain part of the original Release 5 vision but are out of scope for the implemented slice.

- Each seminar may be public or assigned through the same explicit Match any selected classifications or Match all selected classifications rule as CMS. It may offer a distinct price, including free, to public registrants, each classification, or a combination of classifications. When a registrant qualifies for multiple prices, the system applies the lowest eligible price and shows the basis before payment. Each seminar independently enables guest registration, manual payments, capacity limits, waitlists, cancellation and refunds as applicable.

- Each seminar has an administrator-defined cancellation/refund policy that is shown before registration/payment.

- Administrators may publish news and blog posts; the president is an administrator.

## Refund policy implementation

[10 Refund Policy](10-refund-policy.md) governs membership and seminar refunds. Individual registration refunds are administrator-authorized, reasoned, full-only, explicit actions; canceling an individual registration does not automatically refund it. The explicit exception is cancellation of the entire seminar: confirmed Stripe seminar payments are automatically refunded and open Checkout Sessions are expired by the cancellation worker. Original payments remain immutable evidence. Seminar refunds do not change membership entitlement, dates, subscriptions, or membership payment history. Provider-side partial refunds, disputes, chargebacks, and unmatched state produce reconciliation findings.


## 12. Stripe Checkout retry behavior

A membership Checkout request is reused only while its append-only `membership_checkout_sessions`
evidence row is open and a fresh provider retrieval confirms that the Session remains open,
unexpired, and has a usable URL. Each row retains profile, mode, paid-through cycle, provider Session
ID, status, expiration, URL, attempt, and idempotency key. A transaction-scoped profile lock makes
concurrent retries converge. If Stripe reports expired, completed, canceled, or otherwise unpayable,
the old row is marked terminal and retained, and a new attempt/key is created. A browser retry never
returns an expired payment URL.

## Member phone requirement

New member onboarding requires an international phone number selected with its country calling code. The application stores the normalized international value on the member profile. Existing profiles created before migration `0060` may remain without a phone value; this forward requirement must not invalidate or block unrelated edits to legacy profiles.
