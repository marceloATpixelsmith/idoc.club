# Auth, membership billing, and seminar registration — current staging alignment

**Status:** Current-state alignment for the `staging` branch
**Aligned:** 3 October 2026

This document records the implemented cross-domain behavior that must stay consistent across authentication, membership billing/access, and seminar registration. It does not replace the subject documents; it resolves cross-document drift and gives maintainers one place to verify how these three systems interact. When older narrative in a subject document conflicts with the current-state notes added by this alignment pass, the newer current-state note in that subject document governs.

## 1. Authentication and session lifecycle

- IDOC has three authentication roles: Member, Administrator, and Super Admin. Judge, Steward, Judge + Steward, and Veterinarian are membership classifications, not authentication roles.
- Passwords have a 10-character minimum and retain the existing composition/maximum-length policy. Password creation and change flows perform the Have I Been Pwned Pwned Passwords k-anonymity check; breached passwords are rejected.
- Ordinary member returning login uses the email/password flow plus the canonical member login verification flow. A member may trust the current login device for 14 days; the browser stores only an opaque secure `httpOnly` credential and the server stores its keyed digest in the revocable trusted-device registry.
- Administrator and Super Admin login uses authenticator-app TOTP and never uses the ordinary-member 14-day login-device bypass. By default, privileged login challenges for TOTP on every login. A separate canonical privileged remembered-TOTP-device feature exists behind `REMEMBER_TOTP_DEVICE_ENABLED=true`; when that opt-in policy is enabled and a valid remembered-device credential is present, the routine privileged login challenge may be satisfied by that credential. This does not bypass recovery, enrollment, authenticator replacement, or fresh sensitive-action step-up.
- Privileged/sensitive mutations require fresh MFA step-up where defined by the canonical auth contract. Step-up authority is purpose-bound and does not create a second independent login session.
- Every authenticated session is registry-backed. A signed JWT by itself is not sufficient authority; the persisted session must still be active, match the user/session version, and satisfy the session lifetime policy.
- Ordinary member sessions use a 7-day idle timeout and a 14-day absolute lifetime.
- Privileged sessions use a 30-minute idle timeout and a 12-hour absolute lifetime.
- Session revocation and session-version invalidation are authoritative. Logout revokes the active session and rotates/clears session-bound CSRF evidence.
- Protected pages redirect unauthenticated or expired-session users to sign-in rather than presenting a fake 404.
- Authentication/account-security changes remain subject to the canonical auth evidence matrix and authentication security verification gate.

## 2. Membership payment and access lifecycle

- There is one €80 annual IDOC membership. Professional classification does not alter the membership fee.
- First payment presents one membership with an automatic-renewal choice. Automatic renewal uses Stripe subscription Checkout; manual/non-recurring renewal uses one-time Stripe payment Checkout.
- Browser success redirects never grant membership. Entitlement changes only after verified, idempotent Stripe webhook processing validates the expected membership payment evidence.
- `valid_until` is the paid-through date. Early renewal adds 12 months to the existing paid-through date; a payment after expiry starts a new 12-month term from the successful payment date.
- Failed recurring renewal enters the five-calendar-day grace policy without moving `valid_until`. The separate `grace_ends_on` records the inclusive end of grace.
- A never-paid account, or a previously paid account after grace ends, is denied ordinary entitled-member dashboard/content capabilities and is routed to the membership-payment experience for membership access. Read-only own-account/profile boundaries remain available where explicitly permitted by the account-access policy, and seminar registration is a deliberate exception: a signed-in profile without current membership entitlement may register at the non-member seminar price and manage that durable registration history. Hiding navigation is not sufficient; each server-rendered page, action, handler, and data-access boundary enforces its own account-function policy.
- Turning automatic renewal off does not cancel membership. The active Stripe subscription is set to `cancel_at_period_end`; access remains through the already-paid term and applicable grace.
- Turning automatic renewal on for an existing non-recurring member uses Stripe Checkout in `setup` mode to collect authorization without charging immediately. The pending recurring transition is effective on the current `valid_until`, and the webhook path creates/persists the future subscription schedule from verified setup evidence.
- A pending renewal-mode change can be canceled before it takes effect. Idempotency keys and persisted transition state prevent duplicate subscription schedules, subscriptions, or Checkout sessions.
- Self-service membership cancellation is distinct from changing renewal preference: cancellation immediately removes entitlement by suspending the membership, cancels open recurring billing, removes marketing enrollment, and revokes sessions/devices while retaining the account for future sign-in/reactivation.
- Membership payments and seminar payments are separate ledgers and webhook classifications. A seminar payment can never extend membership entitlement.

## 3. Seminar/course registration and payment lifecycle

User-facing text says **Seminars/Courses**. Every seminar/course has **one price** for everyone (the former separate non-member price and the guest/non-member pricing logic are retired). Three independent durable facts describe a registration: its lifecycle status (`registered` / `canceled`), its **Payment Status**, and its **Registration Status** (`approval_status`; see 3.3).

**Registration is members-only.** A signed-out visitor, or a signed-in account without current membership entitlement, can still browse the seminar/course listing and detail pages but is shown no Register button, and every registration function re-authorizes server-side (`requireAccountAccess('member')`, current entitlement). The anonymous guest flow — guest contact form, Turnstile/rate-limited guest registration, anonymous Stripe Checkout and the guest-creating webhook — has been removed. Existing guest registrations created before the change are retained as read-only legacy rows (visible to administrators and refundable); a Stripe Checkout Session created by the old guest flow that completes after the change is refunded in full by the verified webhook rather than creating a registration.

### 3.1 Signed-in entitled member

- The registration is tied to the member profile and uses the seminar's single price.
- The member chooses an enabled payment method: Online via Stripe, Bank Transfer, or Cash.
- Bank Transfer/Cash creates the registration immediately with the corresponding pending payment status, queues the branded confirmation email, and routes the member to `/seminars?view=my`.
- Online creates the profile-backed registration first, then redirects to Stripe Checkout. The registration is not marked paid and its confirmation email is not queued until the verified paid Checkout webhook succeeds.
- After successful online payment, the member returns to `/seminars?view=my`.
- **My Seminars/Courses** shows both the **Payment Status** and the **Registration Status**.
- A member whose entitlement has lapsed can still view and cancel an existing registration but cannot register; the detail page points them to renew.

### 3.2 Visitors who cannot register

- A signed-out visitor sees the listing and the full detail page, plus a prompt to sign in or join; no register control and no registration route is reachable.
- A signed-in account without current entitlement sees a prompt to renew or manage the membership.

### 3.3 Registration Status (independent of payment)

| Status | Meaning |
| --- | --- |
| Confirmed | Every registration for a non-FEI seminar/course, from the moment it is made — **payment status has nothing to do with it**. |
| Pending FEI Approval | Every registration for an FEI seminar/course, from the moment it is made, until an administrator records the FEI decision. The email states that the registrant's National Federation must register them with the FEI to be approved to participate. |
| Approved by FEI / Not Approved by FEI / Approved to Audit Only by FEI | Set manually by an administrator on the registration. Each change emails the registrant the same registration details as the confirmation with a message clearly stating the status. |

The column is `idoc.seminar_registrations.approval_status` (migration `0072`; default `confirmed`, existing FEI rows backfilled to `pending_fei_approval`). It is shown and filterable in the Admin Registrations table and exported in the CSVs.

### 3.4 Shared seminar safeguards and administration

- Capacity is enforced under database locking; duplicate member/profile registrations are prevented.
- Canceling a seminar preserves the seminar as canceled. Registrations are canceled; paid Stripe registrations are refunded, and open Stripe Checkout sessions are expired by the resumable cancellation worker.
- Payment method remains visible independently of payment status. Administrators can mark Bank Transfer/Cash registrations paid without rewriting the selected payment method.
- **Administrator-created registrations** (Admin > Registrations > New Registration) support Bank Transfer or Cash only and are attached to an **active member** chosen with a searchable member lookup (name or email); first name, last name, email and phone are no longer entered. Only currently entitled members can be selected and the server re-checks entitlement. The member receives the same confirmation email as a self-registration (including the FEI status message for FEI seminars). The seminar and payment-method fields sit side by side at 50% width each on desktop. An administrator registers a member who was confirmed by the FEI without registering on IDOC the same way, so the registration shows in that member's My Seminars/Courses.
- The seminar form no longer has an Organizing National Federation field (the seminar detail page, listings and emails no longer show it) and has a single **Price (EUR)** field. `organizing_national_federation` and `non_member_price_cents` remain in the shared database only as retained legacy columns (the price is mirrored into `non_member_price_cents` so a still-deployed older build stays coherent); nothing reads them. They will be dropped in a later contract migration once production is promoted.
- Seminar confirmation email content: Online adds the completed-Stripe-payment wording, and Bank Transfer includes the configured bank-transfer instructions; every confirmation states the Registration Status.
- Registration confirmations are delivered through the durable notification outbox. Online confirmations are queued only after verified payment; offline confirmations are queued at successful registration creation. A Registration Status change queues a status-update email on the same (staging-partitioned) confirmation kinds.

## 4. Documentation maintenance rule

Changes to any of these flows must update the applicable governing document in the same PR:

- authentication/session/MFA: docs/13, docs/14, docs/20–24 and generated auth evidence where required;
- membership pricing, entitlement, renewal, cancellation, and grace: docs/02, docs/04, docs/25 and Stripe acceptance evidence where required;
- seminar catalog, registration, payment, cancellation, email, and admin behavior: docs/07 and docs/08;
- this alignment document whenever a change crosses more than one of those domains.

The code paths used for this alignment include `lib/auth/session-tokens.ts`, `lib/auth/login-device-trust.ts`, `lib/auth/mfa/*`, `lib/payments/checkout.ts`, `lib/payments/renewal-preferences.ts`, `lib/payments/webhook-handlers.ts`, `lib/seminars/registrations.ts`, `lib/seminars/checkout.ts`, `lib/seminars/cancellation-worker.ts`, and the member/public seminar Server Actions.

## Member communications and billing launch hold

These communication and live-provider billing flows are conditional on the server-only `DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING` setting. Only exact `false` releases the hold; missing, empty or invalid values block. Validated Stripe sandbox mutations remain usable, but outbound email remains held. Existing authorization, accounting and entitlement rules still apply. Follow [the launch-hold runbook](27-member-communications-and-billing-launch-hold.md) for queue/webhook handling, separate staging/Production configuration and operator release checks.
