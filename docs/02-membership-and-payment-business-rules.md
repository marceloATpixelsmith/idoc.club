**IDOC**

**Membership & Payment Business Rules**

Rules needed to keep membership entitlement correct across Stripe and non-Stripe payments

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.1                                            |
| **Date**             | 11 August 2026                                 |

Working project document. Update this document when project decisions change.

# 1. Membership types

| **Type**        | **Stored representation**                 | **Billing difference** |
|-----------------|-------------------------------------------|------------------------|
| Judge           | Judge role + judge level                  | None                   |
| Steward         | Steward role + steward level              | None                   |
| Judge + Steward | Two role records, each with its own level | None                   |
| Veterinarian    | Veterinarian role                         | None                   |

## 1.1 Approved signup field dictionary

All fields listed below are required. Email is also the member's username. Country and National Federation must use the same canonical, complete country list throughout signup, account administration, migration, and reporting.

### Every member

- Email
- First Name
- Last Name
- Address 1
- Address 2
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
- FEI ID

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

# 2. Pricing

Standard annual membership fee: €80. Professional role and level do not determine price. Billing should therefore use one current canonical Stripe annual Price for new Stripe enrollments, while migrated subscriptions can retain existing Price IDs.

# 3. Membership entitlement rules

- Membership entitlement is represented by the IDOC membership record.

- A successful eligible payment may create or extend entitlement, but entitlement can also be created by an authorized manual/complimentary action.

- Canceling auto-renewal does not necessarily terminate access immediately; access normally continues through the paid-through date.

- A failed recurring payment follows the approved grace-period rule rather than automatically deleting the membership record.

- Suspension is an administrative state that can override a paid-through date.

- Professional level changes do not reset or alter the paid-through date.

# 4. Payment sources

| **Source**             | **Automation**                   | **Required stored evidence**                                                  |
|------------------------|----------------------------------|-------------------------------------------------------------------------------|
| Stripe recurring       | Webhook-driven                   | Customer ID, Subscription ID, invoice/payment identifiers, status, period end |
| Stripe one-time        | Webhook-driven if supported      | Customer/payment identifier, amount, paid date                                |
| PayPal                 | Manual or future API integration | Transaction/reference, paid date, amount, administrator                       |
| Bank transfer          | Manual                           | Reference, paid date, amount, administrator                                   |
| Cash / in person       | Manual                           | Receipt/reference if available, paid date, amount, administrator              |
| Complimentary / waived | Manual administrator action      | Reason, approver, effective dates                                             |

# 5. Renewal logic

Before implementation, IDOC must choose one of the following membership-calendar models. The system should implement exactly one approved policy.

| **Model**             | **Description**                                                                   | **Advantages**                                                                 | **Risks**                                                                   |
|-----------------------|-----------------------------------------------------------------------------------|--------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| Rolling anniversary   | Each payment extends the member from the relevant paid-through date for one year. | Simple for individual renewals; naturally matches Stripe annual subscriptions. | Members have different renewal dates.                                       |
| Fixed membership year | Membership is valid to a common annual date.                                      | Administrative simplicity if IDOC historically works this way.                 | Proration, late renewals and Stripe anniversaries require additional rules. |

# 6. Stripe subscription status mapping

| **Stripe state/event**                   | **Recommended IDOC action**                                                                                      |
|------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| invoice.paid                             | Record payment; extend/confirm entitlement according to renewal policy.                                          |
| invoice.payment_failed                   | Record billing problem; enter grace state if policy allows; notify member.                                       |
| customer.subscription.updated            | Refresh local subscription metadata; do not blindly alter membership without interpreting status and period end. |
| customer.subscription.deleted            | Mark subscription ended; preserve membership until valid_until unless administratively overridden.               |
| Subscription cancel_at_period_end = true | Show non-renewing status; retain entitlement through paid-through date.                                          |

# 7. Administrator rules for manual payments

1. Administrator finds the existing member rather than creating a duplicate.

2. Administrator records payment source, amount, currency, paid date and reference.

3. System calculates the proposed new valid-through date using the approved renewal rule.

4. Administrator confirms the result.

5. System writes the payment, membership change and audit entry in one transaction.

6. Any backdated or unusually long extension requires a reason and elevated permission.

# 8. Duplicate prevention

- Use normalized email, legacy WordPress user ID and external billing identifiers during migration matching.

- Do not create a new member merely because a Stripe Customer has a different email; place ambiguous matches in review.

- Do not attach one Stripe Subscription to more than one profile.

- Provide an administrator merge workflow or migration-only merge tool for verified duplicates.

# 9. Member-facing wording requirement

Existing migrated users should encounter an account-access/activation flow, not language suggesting they must purchase or create a new membership. Their existing entitlement and billing relationship must already exist before they first log in.
