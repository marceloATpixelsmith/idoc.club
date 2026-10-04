# Auth, membership billing, and seminar registration — current staging alignment

**Status:** Current-state alignment for the `staging` branch  
**Aligned:** 3 October 2026

This document records the implemented cross-domain behavior that must stay consistent across authentication, membership billing/access, and seminar registration. It does not replace the subject documents; it resolves cross-document drift and gives maintainers one place to verify how these three systems interact. When older narrative in a subject document conflicts with the current-state notes added by this alignment pass, the newer current-state note in that subject document governs.

## 1. Authentication and session lifecycle

- IDOC has three authentication roles: Member, Administrator, and Super Admin. Judge, Steward, Judge + Steward, and Veterinarian are membership classifications, not authentication roles.
- Passwords have a 10-character minimum and retain the existing composition/maximum-length policy. Password creation and change flows perform the Have I Been Pwned Pwned Passwords k-anonymity check; breached passwords are rejected.
- Ordinary member returning login uses the email/password flow plus the canonical member login verification flow. A member may trust the current login device for 14 days; the browser stores only an opaque secure `httpOnly` credential and the server stores its keyed digest in the revocable trusted-device registry.
- Administrator and Super Admin login uses authenticator-app TOTP and does not use the ordinary-member login-device bypass.
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
- A never-paid account, or a previously paid account after grace ends, is restricted to the membership-payment experience plus logout. Hiding navigation is not sufficient; server-rendered pages, actions, handlers, and data access enforce the entitlement boundary.
- Turning automatic renewal off does not cancel membership. The active Stripe subscription is set to `cancel_at_period_end`; access remains through the already-paid term and applicable grace.
- Turning automatic renewal on for an existing non-recurring member uses Stripe Checkout in `setup` mode to collect authorization without charging immediately. The pending recurring transition is effective on the current `valid_until`, and the webhook path creates/persists the future subscription schedule from verified setup evidence.
- A pending renewal-mode change can be canceled before it takes effect. Idempotency keys and persisted transition state prevent duplicate subscription schedules, subscriptions, or Checkout sessions.
- Self-service membership cancellation is distinct from changing renewal preference: cancellation immediately removes entitlement by suspending the membership, cancels open recurring billing, removes marketing enrollment, and revokes sessions/devices while retaining the account for future sign-in/reactivation.
- Membership payments and seminar payments are separate ledgers and webhook classifications. A seminar payment can never extend membership entitlement.

## 3. Seminar registration and payment lifecycle

Seminars have separate member and non-member prices. Registration status and payment status are independent durable facts.

### 3.1 Signed-in entitled member

- The registration is tied to the member profile and uses the member price.
- The member chooses an enabled payment method: Online via Stripe, Bank Transfer, or Cash.
- Bank Transfer/Cash creates the registration immediately with the corresponding pending payment status, queues the branded confirmation email, and routes the member to `/seminars?view=my`.
- Online creates the profile-backed registration first, then redirects to Stripe Checkout. The registration is not marked paid and its confirmation email is not queued until the verified paid Checkout webhook succeeds.
- After successful online payment, the member returns to `/seminars?view=my`.

### 3.2 Signed-in account holder without current membership entitlement

- If the account has its own member profile, the seminar registration remains tied to that real profile rather than becoming a guest registration.
- The non-member seminar price applies.
- The same payment-method, redirect, history, cancellation, and Stripe-verification behavior applies as for an entitled member.

### 3.3 Anonymous guest — Bank Transfer or Cash

- The public Register flow uses the guest registration dialog and collects first name, last name, email, and international phone number.
- Client-side validity controls submission; server-side schemas normalize and validate all four contact fields.
- Anonymous submission is protected by CSRF, Turnstile, and email/origin rate limiting.
- A successful Bank Transfer/Cash registration is created immediately at the non-member price with pending payment status, and the branded confirmation email is queued.
- The success state returns to the seminar detail page using server-backed flash state; it does not depend on disposable URL query parameters.

### 3.4 Anonymous guest — Online via Stripe

- The flow is Stripe-first. IDOC does not ask the guest to enter contact details before redirecting.
- Stripe Checkout collects email and phone natively plus required First name and Last name custom fields.
- No guest registration row is created before payment.
- On the verified paid Checkout webhook, IDOC re-retrieves/validates provider evidence, rechecks seminar status, registration deadline, capacity, amount, currency, and duplicate email, then creates the paid guest registration and queues the same branded registration confirmation.
- If the paid Checkout can no longer become a valid registration (for example the seminar filled, closed, or duplicate registration now exists), the webhook attempts an idempotent automatic refund and records reconciliation evidence if manual attention is required.
- Guest online success returns to the seminar detail page through server-backed flash state.

### 3.5 Shared seminar safeguards and administration

- Capacity is enforced under database locking; duplicate member/profile registrations and duplicate guest-email registrations are prevented.
- Canceling a seminar preserves the seminar as canceled. Registrations are canceled; paid Stripe registrations are refunded, and open Stripe Checkout sessions are expired by the resumable cancellation worker.
- Payment method remains visible independently of payment status. Administrators can mark Bank Transfer/Cash registrations paid without rewriting the selected payment method.
- Administrator-created seminar registrations support Bank Transfer or Cash only. If the entered email belongs to an existing profile, the registration attaches to that profile and uses the member price only when the membership is currently entitled; otherwise it uses the non-member price. Unknown emails create guest registrations.
- Seminar confirmation email content is shared across member and guest registrations; Online adds the completed-Stripe-payment wording, and Bank Transfer includes the configured bank-transfer instructions.
- Registration confirmations are delivered through the durable notification outbox. Online confirmations are queued only after verified payment; offline confirmations are queued at successful registration creation.

## 4. Documentation maintenance rule

Changes to any of these flows must update the applicable governing document in the same PR:

- authentication/session/MFA: docs/13, docs/14, docs/20–24 and generated auth evidence where required;
- membership pricing, entitlement, renewal, cancellation, and grace: docs/02, docs/04, docs/25 and Stripe acceptance evidence where required;
- seminar catalog, registration, payment, cancellation, email, and admin behavior: docs/07 and docs/08;
- this alignment document whenever a change crosses more than one of those domains.

The code paths used for this alignment include `lib/auth/session-tokens.ts`, `lib/auth/login-device-trust.ts`, `lib/auth/mfa/*`, `lib/payments/checkout.ts`, `lib/payments/renewal-preferences.ts`, `lib/payments/webhook-handlers.ts`, `lib/seminars/registrations.ts`, `lib/seminars/checkout.ts`, `lib/seminars/cancellation-worker.ts`, and the member/public seminar Server Actions.
