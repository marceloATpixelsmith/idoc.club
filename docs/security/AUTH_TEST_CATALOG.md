# Authentication & Security Test Catalog

**Authoritative source:** `tests/auth/auth-test-matrix.json`. This document is generated from that file. Do not edit pass/fail criteria here independently.

## Operating model

CI and live staging are two execution layers for the same requirements. CI proves deterministic repository-controlled behavior; live staging proves deployment, browser, real-provider, real-email, cookie/domain, and operational behavior. Results must always use the same `LIVE-AUTH-###` IDs.

A defect is not fully regression-covered until it maps to one of these IDs (or a new ID is added), has CI coverage where technically possible, and has live coverage when the failure depends on deployment/provider/runtime behavior.

## LIVE-AUTH-001 — Email/password signup succeeds and establishes the correct initial account state

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-IDENTITY-003, AUTH-EMAIL-001
- **CI coverage:** mapped — `tests/auth-email-resend-safety.integration.ts`, `tests/email-identity-normalization.integration.ts`, `tests/member-launch-hold.integration.ts`, `tests/member-launch-hold.test.ts`, `tests/security-e2e/member-lifecycle.spec.ts`, `tests/security-e2e/member-signup.spec.ts`
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.
- Staging keeps DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING=true; only authentication OTP to this run's disposable @pixelsmith.space mailbox may be delivered.

### Steps
1. Reuse the run's disposable mailbox/account when it is in a clean state; create a mailbox and account only if the run does not already have one suitable for this signup journey.
2. Complete signup with valid required fields and a valid password.
3. Complete any real email verification/OTP step delivered to the mailbox.
4. Observe the post-signup destination and persisted account state.

### PASS
- Exactly one account is created for the normalized email identity.
- The verification/OTP is accepted only once and the user lands in the expected onboarding/account state.

### FAIL
- Signup creates duplicate identities, skips required verification, leaks sensitive data, or lands in an unauthorized state.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-002 — Signup rejects duplicate/invalid identities without account enumeration

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-IDENTITY-003, AUTH-ERROR-001
- **CI coverage:** mapped — `tests/email-identity-normalization.integration.ts`, `tests/auth-error-classes.integration.ts`, `tests/rate-limit-normalization.integration.ts`, `tests/security-e2e/member-signup.spec.ts`
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Attempt signup with invalid email syntax, whitespace/case variants of an existing email, and the exact existing email.
2. Compare UI and network responses for existing versus non-existing identities.

### PASS
- Invalid input is rejected; case/whitespace variants do not create a second identity; responses do not materially reveal whether an account already exists.

### FAIL
- A duplicate account is created or response details enumerate account existence.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-003 — Password login accepts valid credentials and rejects invalid/unknown credentials safely

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-STORAGE-004, AUTH-ERROR-001, AUTH-RATE-001
- **CI coverage:** mapped — `tests/password-hash.test.ts`, `tests/auth-error-classes.integration.ts`, `tests/rate-limit-normalization.integration.ts`, `tests/security-e2e/member-signin.spec.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Login with valid credentials.
2. Try a wrong password for the same account.
3. Try an unknown email.
4. Repeat failed attempts enough to exercise throttling without high-volume load.

### PASS
- Valid login succeeds; invalid/unknown credentials fail with non-enumerating messaging; throttling eventually applies and legitimate access recovers according to policy.

### FAIL
- Invalid credentials authenticate, account existence is disclosed, or rate limiting is bypassed by trivial normalization changes.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-004 — Google OAuth live flow preserves transaction binding and account-linking rules

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-OAUTH-002, AUTH-TRANSACTION-010, AUTH-IDENTITY-005
- **CI coverage:** mapped — `tests/security-e2e/google-oauth.spec.ts`, `tests/identity-ownership.integration.ts`, `tests/google-oauth-secret-rotation.test.ts`, `tests/google-oauth-secret-audit.integration.ts`
- **Live:** required; email=no; admin=no; destructive=no
- **Automation:** manual-only — Real Google OAuth consent and account selection are excluded from automated GitHub live tests by the agreed test scope; provider configuration and callback security remain covered by CI tests.

### Preconditions
- Manual verification only. Do not run Google OAuth consent/account-selection as an automated GitHub live test.

### Steps
1. Excluded from the GitHub automated live suite by agreement; use the existing CI integration/security coverage for provider callback and transaction-binding behavior.

### PASS
- The automated live workflow reports this case as manual-only and does not imply that real Google consent was tested.

### FAIL
- The automated workflow attempts real Google consent or reports this case as an automated pass.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-005 — Logout and session invalidation prevent post-logout reuse

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-SESSION-002, AUTH-SESSION-009, AUTH-SESSION-010
- **CI coverage:** mapped — `tests/security-e2e/sessions.spec.ts`, `tests/security-e2e/session-replay.spec.ts`, `tests/canonical-session-lifecycle.test.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Authenticate normally.
2. Open protected content in two tabs.
3. Logout in one tab.
4. Use browser back and direct protected URLs/API requests from the other tab.

### PASS
- The logged-out session is rejected by protected pages and APIs; cached/back navigation does not restore authorized data; logout state is consistent across tabs after revalidation.

### FAIL
- A revoked/logged-out session can still access protected data or mutate state.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-006 — Anonymous and incomplete-auth sessions cannot access protected pages or APIs

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUTHZ-001, AUTH-FRAMEWORK-001, AUTH-API-004
- **CI coverage:** mapped — `tests/security-e2e/auth-boundaries.spec.ts`, `tests/security-e2e/api-authorization-disclosure.spec.ts`, `tests/authorization-matrix.integration.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Without authentication, request representative member, admin, and security pages directly.
2. Call representative protected APIs directly.
3. Repeat using a pending/incomplete authentication state where available.

### PASS
- UI routes redirect/deny appropriately and APIs independently return 401/403 without protected data.

### FAIL
- Any protected resource is returned because a UI-only or middleware-only boundary was bypassed.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-007 — Unpaid/expired member sees only the payment page while signed in

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUTHZ-001
- **CI coverage:** mapped — `tests/security-e2e/auth-boundaries.spec.ts`, `tests/security-e2e/dashboard-membership-tabs.spec.ts`, `tests/security-e2e/member-lifecycle.spec.ts`, `tests/security-e2e/password-recovery-and-change.spec.ts`, `tests/security-e2e/membership-access-gate.spec.ts`, `tests/session-gate.test.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Authenticate as an unpaid or lapsed disposable member (completed onboarding, no current membership).
2. Confirm the first screen after sign-in is the membership-payment page.
3. Directly request the homepage, a public page (for example /seminars), ordinary member dashboard routes, /admin, and a non-GET request to a gated page.
4. Confirm /terms and /privacy remain reachable and that signing out restores the public site.
5. After a test payment and verified webhook, verify access updates.

### PASS
- While signed in, an unpaid or lapsed member can reach only the payment page, the authentication pages, the legal documents and the routes the payment flow needs; every other page redirects to the payment page and any other non-GET request is refused.
- The payment flow is reachable directly; post-payment entitlement updates correctly; direct navigation never surfaces an uncaught error or generic error boundary.

### FAIL
- A signed-in unpaid or lapsed member can see the public site, member dashboard content, or register for a seminar, is trapped on an incorrect page, or a gated route surfaces an uncaught error instead of a clean redirect.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-008 — Onboarding cannot be skipped or corrupted by direct navigation/query manipulation

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUTHZ-001, AUTH-TRANSACTION-002
- **CI coverage:** mapped — `tests/security-e2e/auth-boundaries.spec.ts`, `tests/security-e2e/member-lifecycle.spec.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Create an onboarding-state account.
2. Try deep links to later dashboard/onboarding steps.
3. Test valid and invalid membership preselection query values.
4. Refresh/back during onboarding.

### PASS
- Required earlier state cannot be skipped; a deep link to a later dashboard/onboarding step redirects cleanly back to /dashboard (HTTP 307, no server error page); invalid query values are rejected/ignored safely; refresh/back preserves a coherent state.

### FAIL
- Direct navigation grants access/state that should require a prior onboarding step, OR produces an uncaught server error (HTTP 500 / generic error boundary) instead of a clean redirect -- a crash is not a pass just because it also grants no access.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-009 — Required TOTP enrollment cannot be bypassed and produces a usable factor

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-MFA-001, AUTH-MFA-002
- **CI coverage:** mapped — `tests/production-mfa-finalization.integration.ts`, `tests/security-e2e/mfa-production-boundaries.spec.ts`
- **Live:** required; email=no; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Use a disposable privileged identity that requires MFA enrollment.
2. Attempt protected navigation before enrollment completes.
3. Complete enrollment with the authenticator secret/QR provided by the application.
4. Verify the new TOTP factor on the next challenge.

### PASS
- Enrollment is mandatory for the applicable role; protected access remains blocked until completion; the enrolled factor works and no raw secret leaks after enrollment.

### FAIL
- Enrollment is skippable or protected access is granted before factor activation.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-010 — Pending-MFA login state is isolated from fully authenticated authority

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-MFA-002, AUTH-MFA-006
- **CI coverage:** mapped — `tests/canonical-mfa-runtime.test.ts`, `tests/security-e2e/mfa-production-boundaries.spec.ts`
- **Live:** required; email=no; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Complete primary authentication for an MFA-required account but stop at the TOTP challenge.
2. Request protected dashboard/admin URLs and APIs directly.
3. Submit malformed, wrong, old, and then valid TOTP codes.

### PASS
- Before valid MFA, protected pages/APIs are denied and no full session is issued; invalid codes are inert; valid code upgrades to the intended authenticated state exactly once.

### FAIL
- Pending MFA authority can access protected resources or an invalid/replayed code completes authentication.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-011 — Recovery codes are single-use, bound to the intended account, and regeneration invalidates old codes

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-MFA-006, AUTH-STORAGE-006
- **CI coverage:** mapped — `tests/auth-recovery-adversarial.integration.ts`, `tests/mfa-store.integration.ts`
- **Live:** required; email=no; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Use one recovery code on a disposable MFA account.
2. Attempt to reuse the same code.
3. Regenerate recovery codes after fresh step-up.
4. Attempt an old pre-regeneration code.

### PASS
- A recovery code succeeds once only; reuse fails; regeneration requires fresh authority and invalidates the prior set.

### FAIL
- Any used/old code can be replayed or regeneration occurs without required step-up.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-012 — Remembered-device trust is scoped and does not bypass fresh step-up

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-REMEMBER-001, AUTH-REMEMBER-002, AUTH-REMEMBER-003, AUTH-REMEMBER-004
- **CI coverage:** mapped — `tests/canonical-mfa-runtime.test.ts`, `tests/production-mfa-finalization.integration.ts`, `tests/security-e2e/member-signin.spec.ts`
- **Live:** required; email=no; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Opt into trusted-device behavior on one browser.
2. Start a new session in that browser and in a separate browser/context.
3. Attempt a sensitive action requiring fresh step-up from the trusted browser.
4. Clear trust cookies and retry login.

### PASS
- Only the intended browser is remembered; clearing cookies removes local trust; remembered login never substitutes for fresh step-up on sensitive actions.

### FAIL
- Trust spreads to another browser/account or suppresses required sensitive-action step-up.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-013 — Fresh MFA step-up automatically resumes the original programmed action exactly once

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-MFA-006, AUTH-TRANSACTION-003, AUTH-TRANSACTION-004
- **CI coverage:** mapped — `tests/fresh-mfa-step-up.test.ts`, `tests/security-e2e/mfa-production-boundaries.spec.ts`, `tests/admin-news-blog-bulk-delete.test.ts`
- **Live:** required; email=no; admin=yes; destructive=yes

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. For each sensitive action in the documented matrix, initiate the action without recent step-up.
2. Submit a wrong TOTP and verify no mutation.
3. Submit a valid TOTP once.
4. Do not click the original action a second time; inspect the resulting state/network activity.
5. Replay refresh/back/callback state after completion.
6. On disposable admin-table records, exercise Delete selected and confirm fresh MFA resumes the exact selected destructive action without a second click.

### PASS
- Wrong code is inert; valid TOTP causes the programmed original action to resume automatically exactly once; no second user click is needed; replay does not repeat the mutation.
- Admin bulk deletion cannot mutate before fresh step-up, preserves server-side eligibility/retention checks, and executes once after valid MFA.

### FAIL
- Mutation happens before valid step-up, requires a second original click, executes twice, or can be replayed.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-014 — Password change enforces current authority and invalidates the old credential as designed

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-PASSWORD-005, AUTH-LIFECYCLE-002
- **CI coverage:** mapped — `tests/account-security-management.test.ts`, `tests/password-security-hardening.test.ts`, `tests/security-e2e/password-recovery-and-change.spec.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Attempt password change with incorrect current password/step-up state.
2. Complete a valid password change.
3. Logout and try both old and new passwords.
4. Check other active sessions against documented policy.

### PASS
- Unauthorized change is rejected; valid change succeeds; old password stops authenticating; new password works; session invalidation matches documented policy.

### FAIL
- Password changes without required authority or the old password remains valid unexpectedly.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-015 — Password reset tokens are non-enumerating, single-use, expiring, and actually replace the credential

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-TRANSACTION-003, AUTH-STORAGE-005
- **CI coverage:** mapped — `tests/password-reset-adversarial.integration.ts`, `tests/account-token-lifecycles.integration.ts`, `tests/security-e2e/password-recovery-and-change.spec.ts`
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Use the run's existing disposable account and mailbox; create them only if no suitable account exists.
2. Use the real email reset link once.
3. Attempt reuse and a modified token.
4. Request a second reset and check supersession behavior.
5. Verify old/new passwords after successful reset.

### PASS
- Request responses do not enumerate accounts; valid token works once; modified/reused/expired/superseded tokens fail; credential changes as expected.

### FAIL
- Reset token can be replayed/modified, account existence leaks, or old credential remains usable contrary to policy.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-016 — Email change preserves identity uniqueness and requires the current password and the intended verification/step-up

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-EMAIL-003, AUTH-IDENTITY-003, AUTH-IDENTITY-005
- **CI coverage:** mapped — `tests/email-change.integration.ts`, `tests/email-identity-normalization.integration.ts`, `tests/profile-account-combined-save.integration.ts`
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.
- The disposable member must have a password (a Google-only account cannot change its login email until it sets one).

### Steps
1. Use the run's existing disposable account and create a second mailbox only when a distinct new email address is required for the change.
2. Attempt a duplicate existing address and case/whitespace equivalent.
3. Complete any real verification step.
4. Test login/identity behavior at old and new addresses.
5. Edit the login email on My Profile and confirm a Current password field appears; submit with the field empty, then with a wrong password, and confirm each is refused with no verification email sent to the new address.
6. Repeat the wrong-password attempt using an address that already belongs to another account and confirm the response is identical (the duplicate check must not answer a caller that has not proved the password).
7. Submit with the correct current password and complete the real verification step.

### PASS
- Change requires intended authority/verification; duplicate normalized identities are rejected; resulting login identity is unambiguous.
- A login email change is refused without the member's current password (pentest finding 1): no verification mail is issued, the response does not reveal whether the new address is taken, and a session alone can never rebind the recovery address.

### FAIL
- Email can be changed to an existing normalized identity or without required verification/step-up.
- The login email can be changed, or a verification mail issued, with only a valid session (no or wrong current password), or the duplicate-address answer differs before the password is proved.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-017 — Role boundaries and object ownership resist direct URL/API ID tampering

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUTHZ-001, AUTH-AUTHZ-005, AUTH-API-004
- **CI coverage:** mapped — `tests/authorization-boundary-inventory.test.ts`, `tests/authorization-matrix.integration.ts`, `tests/authorization-privilege-boundaries.integration.ts`, `tests/security-e2e/api-authorization-disclosure.spec.ts`, `tests/admin-news-blog-bulk-delete.test.ts`, `tests/security-e2e/dashboard-membership-tabs.spec.ts`
- **Live:** required; email=no; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. As a normal member, directly request admin routes/APIs.
2. Verify an unauthorized visit to /admin and a Super Admin-only admin page renders a safe denial instead of a generic retry screen.
3. As an administrator, alter target user/member IDs to another account and attempt out-of-scope actions.
4. Attempt self-elevation or role mutation outside permitted scope.
5. Attempt bulk delete against protected targets: the acting admin, another privileged administrator, a seminar with registrations, a payment-evidenced registration, and an open support conversation.

### PASS
- Every server-side boundary rejects unauthorized role/object access with 401/403 or equivalent safe denial; no protected data or mutation occurs.
- An unauthorized administrator page visit has a safe denial with no protected navigation data, while an authorized administrator can load the page.

### FAIL
- Hidden UI is the only boundary, object ID substitution works, or a user can elevate privileges.
- An authorization denial renders the generic runtime error and retry screen, or hides a real data-loading failure as an access denial.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-018 — CSRF defenses reject forged state-changing requests without damaging the valid session

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-CSRF-003
- **CI coverage:** mapped — `tests/security-e2e/csrf.spec.ts`, `tests/pending-flow-csrf-nonce.integration.ts`, `tests/admin-news-blog-bulk-delete.test.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Capture a legitimate state-changing request from a disposable account.
2. Replay it with missing/tampered CSRF material and with a forged Origin where applicable.
3. Then perform the legitimate action normally.

### PASS
- Forged requests are rejected before mutation; legitimate session remains valid; correct same-origin request succeeds.

### FAIL
- Mutation succeeds with missing/tampered CSRF protections or the failed attack corrupts the legitimate session.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-019 — Session fixation, token tampering, stale-session replay, and revoked-session reuse fail closed

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-SESSION-002, AUTH-SESSION-009, AUTH-SESSION-010
- **CI coverage:** mapped — `tests/session-registry-adversarial.integration.ts`, `tests/security-e2e/session-replay.spec.ts`, `tests/security-e2e/auth-boundaries.spec.ts`, `tests/session-token-boundaries.test.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Capture pre-login and post-login session state.
2. Verify session rotation/authority transition.
3. Attempt safe replay of stale/revoked/tampered session material only on disposable accounts.
4. For protected page routing, explicitly verify /dashboard, /admin, and /onboarding (plus representative descendants where applicable) redirect an unauthenticated or server-invalid session to /sign-in; separately verify a genuinely authenticated non-admin user still receives the configured authorization-denial behavior for /admin.
5. With an authenticated protected dashboard already open, invalidate that session server-side, then return focus to the browser without clicking a dashboard control or refreshing; verify the stale protected page immediately leaves for /sign-in.

### PASS
- Authentication does not preserve attacker-controlled pre-auth authority; stale/revoked/tampered sessions are rejected by protected resources with a clean redirect/denial (307 to /sign-in for unauthenticated /dashboard, /admin, and /onboarding page access; null/401/403 for an API). An already-open protected page whose session later becomes invalid automatically leaves for /sign-in when the browser resumes/focuses and identity revalidation returns null, without requiring a click or manual refresh. An authenticated but non-admin account may still receive the deliberate branded 404 for /admin. An uncaught server error or a 404 caused solely by an expired/missing session is a failure.

### FAIL
- A stale, revoked, or tampered session grants authenticated authority, OR its rejection surfaces as an uncaught error/generic error boundary rather than a clean redirect/denial, OR an already-open protected page remains visible after session-loss revalidation (for example, only swapping to logged-out navigation until the user clicks or refreshes).

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-020 — Rate limits resist trivial identity/origin normalization bypass and recover according to policy

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-RATE-001, AUTH-RATE-004
- **CI coverage:** mapped — `tests/rate-limit-normalization.integration.ts`, `tests/rate-limit-correlation.integration.ts`, `tests/security-e2e/member-signin.spec.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Exercise failed login/reset/MFA attempts at a bounded rate on disposable identities.
2. Repeat using safe case/whitespace variants and controlled client contexts.
3. After the documented window/recovery mechanism, verify legitimate behavior resumes.

### PASS
- Limits activate without high-volume load, normalization variants do not trivially bypass them, and legitimate access recovers as designed.

### FAIL
- Simple normalization changes reset protection or rate-limit failure exposes internal errors.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-021 — Turnstile/bot controls fail closed when required and cannot be bypassed by direct API calls

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-BOT-001, AUTH-BOT-002
- **CI coverage:** mapped — `tests/turnstile-contract.test.ts`, `tests/turnstile-retry-restore.test.ts`, `tests/turnstile-widget-resilience.test.ts`, `tests/turnstile-signal.test.ts`, `tests/security-e2e/member-signup.spec.ts`, `tests/security-e2e/turnstile-widget-behavior.spec.ts`
- **Live:** required; email=no; admin=no; destructive=no
- **Automation:** automated — Staging uses Cloudflare's always-pass keys, so the runner proves the silent pass on every gated page and the visible fail-closed behavior when the Cloudflare script is blocked, and reports the case as partial. An interactive challenge cannot be solved on staging; CI (tests/security-e2e/turnstile-widget-behavior.spec.ts) and the manual/weekly 'Turnstile real Cloudflare check' workflow cover it.

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Run the normal human flow.
2. Where safely possible, submit without/with invalid Turnstile proof or invoke the protected API directly.
3. Verify the UI recovers from a failed challenge without losing unrelated form state.
4. On staging (always-pass keys) open the sign-in, sign-up and recover-password pages, type a valid email without submitting, and confirm the submit button enables with no 'security check didn't load' message.
5. With the Cloudflare script blocked, confirm the page shows the retry message, keeps the submit button disabled and sends no form request.

### PASS
- Required bot proof is enforced server-side; invalid/missing proof fails closed; normal challenge succeeds; retry UX remains usable.

### FAIL
- API bypass skips required bot validation or provider/challenge failure silently allows the protected action.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-022 — Sign-in return paths cannot escape approved application destinations

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-TRANSACTION-010
- **CI coverage:** mapped — `tests/return-to-path.test.ts`, `tests/general-navigation.test.ts` — Safe return-path behavior is tested with the application's password/email sign-in flow; Google consent and provider callback replay remain in LIVE-AUTH-004 and are manual-only.
- **Live:** required; email=no; admin=no; destructive=no
- **Automation:** automated — These return-path checks do not require Google consent and run through password/email authentication.

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Request sign-in using safe return-path values that are external, protocol-relative, encoded, malformed, or outside the approved protected route set.
2. Complete the normal password/email authentication flow with those values and inspect the final destination.
3. After a successful return, start a separate sign-in without a return path and verify no stale destination is reused.

### PASS
- External/unapproved destinations are rejected or normalized to safe internal locations; password/email authentication returns only to an approved same-origin route.
- The remembered destination is cleared after use and cannot be reused by a later authentication.

### FAIL
- Authentication redirects to an attacker-controlled external destination, an unapproved path, or reuses a stale destination.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-023 — Server-side validation rejects request/input tampering independent of the UI

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-API-004, AUTH-AUTHZ-005
- **CI coverage:** mapped — `tests/auth-authority-boundaries.integration.ts`, `tests/authorization-privilege-boundaries.integration.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Using captured disposable-account requests, alter IDs, role values, membership type, extra fields, missing fields, wrong types, and bounded oversized/Unicode inputs.
2. Submit directly to the real staging endpoints.

### PASS
- Server validates authoritative values and rejects malformed/out-of-scope input without mutation or sensitive error disclosure.

### FAIL
- Client-side-only validation can be bypassed to alter authority/state.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-024 — One-time auth operations resist replay and bounded concurrency races

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-TRANSACTION-003, AUTH-TRANSACTION-004, AUTH-MFA-006
- **CI coverage:** mapped — `tests/mfa-store.integration.ts`, `tests/session-registry-adversarial.integration.ts`, `tests/mfa-replay-notifications.integration.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Using disposable tokens/codes, issue two near-simultaneous submissions for a recovery code, reset token, invitation-like one-time token if applicable, or step-up continuation.
2. Observe persisted state and responses.

### PASS
- Exactly one operation wins when semantics are single-use; losing replay/race attempt is rejected; no duplicate mutation occurs.

### FAIL
- Both concurrent/replayed operations succeed or state becomes inconsistent.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-025 — Cookies, HTTPS, caching, CSP/frame protections, and security headers match production expectations

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-SESSION-001, AUTH-TRANSPORT-001, AUTH-FRAMEWORK-001
- **CI coverage:** mapped — `tests/security-e2e/cookies-and-headers.spec.ts`, `tests/content-security-policy.test.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Inspect staging responses and authenticated cookies in the browser/network panel.
2. Verify HTTPS redirect/enforcement, Secure/HttpOnly/SameSite attributes, CSP/frame policy, and sensitive-page cache behavior.

### PASS
- Security headers/cookie attributes match production policy; no mixed content or unsafe caching of authenticated content is observed.

### FAIL
- Sensitive cookies lack required flags, HTTPS is bypassable, or protected responses are cacheable/embedable contrary to policy.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-026 — Security/audit evidence is recorded without secret/token leakage

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUDIT-002, AUTH-LOG-001, AUTH-LOG-003
- **CI coverage:** mapped — `tests/auth-security-events.integration.ts`, `tests/security-event-log-attribution.integration.ts`, `tests/security-event-taxonomy.integration.ts`, `tests/audit-evidence.integration.ts`, `tests/admin-news-blog-bulk-delete.test.ts`
- **Live:** required; email=no; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Perform representative login failure, MFA/recovery, password/email change, role/security actions on disposable accounts.
2. Inspect the authorized audit/security activity view or logs available to the tester.

### PASS
- Expected security events are attributable and useful; passwords, TOTP secrets, recovery codes, session cookies, reset tokens, and mailbox credentials are absent.

### FAIL
- Critical actions leave no expected evidence or secrets/tokens appear in logs/UI/network metadata.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-027 — Authentication dependencies and internal failures fail closed with safe user-facing errors

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-ERROR-001, AUTH-DEPENDENCY-001
- **CI coverage:** mapped — `tests/auth-error-classes.integration.ts`, `tests/dependency-risk-register.test.ts`, `tests/google-oauth-failure-alerting.test.ts`, `tests/security-e2e/member-signup.spec.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Trigger only safe, bounded failure cases available in staging, such as invalid provider callback/state, malformed token, or intentionally unsupported input.
2. Observe UI, HTTP response, and retained auth state.

### PASS
- No protected action succeeds because of dependency/internal failure; user receives a safe actionable/generic message; no stack trace/SQL/provider secret leaks.

### FAIL
- Failure becomes an authentication bypass, crashes the flow into inconsistent authority, or exposes sensitive internals.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-028 — Authorized adversarial sweep finds no bypass across auth, MFA, authorization, replay, CSRF, or identity binding

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUTHZ-001, AUTH-MFA-006, AUTH-CSRF-003, AUTH-SESSION-010
- **CI coverage:** mapped — `tests/authorization-privilege-boundaries.integration.ts`, `tests/security-e2e/auth-boundaries.spec.ts`, `tests/security-e2e/mfa-production-boundaries.spec.ts`, `tests/security-e2e/csrf.spec.ts`, `tests/security-e2e/session-replay.spec.ts`
- **Live:** required; email=no; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. After the normal cases, deliberately replay/modify requests for authentication bypass, MFA/step-up bypass, privilege escalation, IDOR/BOLA, stale-session reuse, CSRF gaps, token/code replay, OAuth/account-link confusion, open redirect, enumeration, and client-side-only authorization.
2. Stay within disposable accounts, the designated staging hostname, and bounded request rates.

### PASS
- No adversarial attempt obtains unauthorized data, authority, or mutation; any finding is reproducible and recorded by the relevant specific LIVE-AUTH case.

### FAIL
- Any unauthorized read/write/authority is achieved or a protection can be bypassed.

### Cleanup
- Do not perform denial-of-service, high-volume load, destructive actions on non-test data, third-party attacks, or testing outside the designated staging hostname.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-029 — Real transactional email dependency works end to end on staging

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-EMAIL-002
- **CI coverage:** mapped — `tests/auth-email-resend-safety.integration.ts`
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Reuse the run's existing disposable mailbox; create one only if none exists.
2. Exercise signup/reset/email-change flows that cause the staged app itself to send mail.
3. Poll the mailbox, verify the intended message/link/code, and continue the real browser flow.

### PASS
- The staged app emits the expected real email and the received link/code successfully completes only the intended flow.

### FAIL
- App reports success but no email arrives, wrong recipient/content is sent, or link/code fails/binds to the wrong purpose.

### Cleanup
- Delete each mailbox once after all dependent flows that use it have passed; preserve it temporarily when failure evidence depends on it.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-030 — Live test environment is the intended staged deployment and evidence is revision-bound

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-OPERATIONS-011
- **CI coverage:** gap — Deployment identity and live-host evidence are inherently operational; repository CI cannot prove which staged deployment Claude reached.
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Before destructive/live actions, record the exact hostname and reject localhost or *.vercel.app preview hosts unless the designated staged hostname itself is intentionally on that domain.
2. Record a revision/build identifier if the deployment exposes one; otherwise record test start time and hostname.
3. Confirm HTTPS and that disposable accounts are being used.

### PASS
- Tester is on the designated staged/live hostname and records enough deployment evidence to tie results to a specific deployed revision/window.

### FAIL
- Tester cannot establish the intended deployment target or accidentally targets a preview/local/production dataset outside the authorized staging scope.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-031 — Cleanup and failure preservation are deterministic and auditable

- **Risk:** medium
- **Applicability:** applicable
- **Canonical controls:** AUTH-OPERATIONS-011
- **CI coverage:** gap — Cleanup of live external test identities/mailboxes is operational evidence, not a repository-only behavior.
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. For passing cases, remove disposable accounts/sessions/mailboxes according to the runbook.
2. For failed cases, preserve only the minimum state needed for debugging and record what was retained.
3. Ensure test admin roles and temporary privileged state are removed.

### PASS
- No unnecessary disposable privileged state remains; failures retain enough bounded evidence for diagnosis; secrets are never stored in reports.

### FAIL
- Temporary privilege/test accounts are left uncontrolled or failure evidence contains secrets.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-032 — Invitation auth testing is explicitly not applicable to the current product model

- **Risk:** low
- **Applicability:** not-applicable
- **Canonical controls:** AUTH-INVITE-001, AUTH-INVITE-002, AUTH-INVITE-003
- **CI coverage:** na — Current canonical auth evidence states there is no live invitation flow; privileged accounts are provisioned directly by Super Admin.
- **Live:** not applicable; email=no; admin=no; destructive=no

### PASS
- No invitation flow exists in the deployed product model.

### FAIL
- A new invitation flow is introduced without first changing this case to applicable and adding CI/live coverage.

### Evidence
- If an invitation feature is introduced, update this catalog in the same change before release.

## LIVE-AUTH-033 — Ordinary member sessions use a 7-day idle timeout and 14-day absolute lifetime while privileged sessions retain strict limits

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-SESSION-005, AUTH-SESSION-010
- **CI coverage:** mapped — `tests/session-token-boundaries.test.ts`, `tests/session-lifetime-policy.integration.ts`, `tests/canonical-session-lifecycle.test.ts`
- **Live:** required; email=no; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use disposable ordinary-member and Administrator/Super Admin test identities.

### Steps
1. Authenticate as an ordinary member and verify the issued session remains valid beyond the former 30-minute idle and 12-hour absolute windows, using controlled test-time/session evidence rather than waiting in real time.
2. Verify the ordinary-member policy is 7 days idle and 14 days absolute, with activity refreshing only the idle timestamp and never the absolute deadline.
3. Authenticate as an Administrator or Super Admin and verify the privileged session still uses the existing 30-minute idle and 12-hour absolute policy.
4. Verify the Active sessions UI/listing applies the same role-specific idle policy and does not hide a still-valid ordinary-member session or retain an idle-expired privileged session.

### PASS
- Ordinary-member sessions use a 7-day idle limit and fixed 14-day absolute limit; privileged sessions remain 30-minute idle and fixed 12-hour absolute.
- Role-specific active-session listing matches token validity and activity never extends the absolute deadline.

### FAIL
- An ordinary member is still forced out by the old 30-minute/12-hour policy, a privileged account receives the longer member lifetime, or active-session listing disagrees with actual token validity.

### Cleanup
- Sign out disposable sessions and remove any temporary privileged role/test state after evidence is captured.

### Evidence
- Record role, issued/observed expiry policy, relevant session-list behavior, HTTP status, and any screenshot/trace needed to prove the deployed behavior. Never record cookie/token values.

## LIVE-AUTH-034 — Signup, password reset and password change reject passwords found in known data breaches

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-PASSWORD-006, AUTH-PASSWORD-007
- **CI coverage:** mapped — `tests/password-breach-check.test.ts`, `tests/password-reset-adversarial.integration.ts`, `tests/security-e2e/member-signup.spec.ts`, `tests/security-e2e/password-recovery-and-change.spec.ts` — The range-check unit test stubs a matching HIBP suffix for deterministic coverage; the password-reset integration test covers the authorized reset boundary. The browser specs drive the real signup, reset and Security-page password-change forms against a local breach-API stand-in, including the operations alert and the documented fail-open behavior.
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use staging.idoc.club, never redesign.idoc.club, a Vercel preview, or localhost.
- Use only a disposable test account and mailbox. Staging shares the production database, so cleanup is required.
- Use the designated test password `Password#1` (10 characters; meets the composition rules) for the live HIBP check. Confirm the range response reports a match before submitting it in signup or password reset; use only the disposable test identity.

### Steps
1. Use the run's existing disposable mailbox/account if it has not completed signup; otherwise create a clean identity only for this signup rejection case.
2. Enter the composition-compliant breached password at password creation and submit.
3. Verify the password is rejected with the breached-password message and no account is created.
4. For reset, use an existing disposable account, request password reset, and complete the required email OTP or privileged TOTP verification.
5. Enter the same currently confirmed breached password and submit.
6. Verify the password is rejected and the prior credential remains valid; then complete reset with a unique, non-breached password.
7. For self-service change, sign in as a disposable paid-up member, open Security settings, enter the current password and the same confirmed breached password as the new one, and submit; verify it is rejected and the current password still works.

### PASS
- Both signup and password reset reject the breached password and allow retry with a unique password.
- The rejected signup creates no account; the rejected reset does not change the existing password.
- Neither the raw password nor its full hash is sent to HIBP; only the 5-character SHA-1 prefix is sent.
- Self-service password change also rejects the breached password and leaves the current credential unchanged; any configured operations alert names the flow and account and never contains the password.

### FAIL
- Either flow accepts the breached password, changes account state before rejecting it, or sends the raw password/full hash to HIBP.

### Cleanup
- Complete a successful reset for the disposable account, then remove disposable account state after evidence is captured.

### Evidence
- Record the test flow, whether HIBP reported the selected password as pwned, visible validation result, and account-state outcome. Never record the password, its hash, OTP/TOTP, cookies, or tokens.

## LIVE-AUTH-035 — Member archive and permanent deletion enforce authorization, billing guards, and audit retention

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUTHZ-001, AUTH-MFA-006, AUTH-CSRF-003
- **CI coverage:** mapped — `tests/admin-table-loading-feedback.test.ts`, `tests/member-lifecycle.integration.ts`, `tests/fresh-mfa-step-up.test.ts`, `tests/csrf-client-cookie-name.test.ts` — The disposable PostgreSQL integration test invokes the same transaction helpers used by the member actions and verifies permanent purge, archive retention, active-subscription and active-role guards, audit actor redaction, immutable-history trigger authorization, and atomic rollback. Shared tests cover the Server Action MFA and CSRF boundaries.
- **Live:** required; email=no; admin=yes; destructive=yes

### Preconditions
- Use the designated staging hostname and a disposable ordinary-member identity.
- Use an identity with no active Stripe subscription; never select an administrator, Super Admin, or the acting administrator.
- Capture the member-linked audit events before the test.

### Steps
1. As an administrator with fresh MFA, archive the disposable member and confirm sign-in is denied while profile, payment, registration, and audit records remain.
2. For a second disposable member with no active subscription, permanently delete the member.
3. Attempt the same operations with an active subscription and verify both are rejected before any records change.
4. Verify the deletion preserves audit events with actor_id cleared and removes the member account and linked records.

### PASS
- Archive removes sign-in and revokes sessions while retaining related records.
- Permanent delete removes the member account and configured linked records, retains audit event rows with null actor references, and is atomic.
- Active subscriptions and privileged/self identities are never changed.

### FAIL
- An unauthorized/CSRF-forged or non-step-up action succeeds; a protected identity is changed; active billing is left chargeable; audit rows are deleted or changed beyond actor redaction; or a failed delete partially purges data.

### Cleanup
- Keep evidence of audit-row preservation and the active-subscription guard; remove disposable state only after evidence is captured.

### Evidence
- Record URL, administrator role, action, response, relevant audit-row IDs and before/after table counts. Do not record credentials or payment secrets.

## LIVE-AUTH-036 — Paid member journey: membership entitlement and seminar payment are granted only by verified provider events, and seminar registration rules hold

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUTHZ-001, AUTH-AUTHZ-005, AUTH-API-004, AUTH-CSRF-003
- **CI coverage:** mapped — `tests/checkout.integration.ts`, `tests/stripe-webhook.integration.ts`, `tests/seminars.integration.ts`, `tests/security-e2e/member-lifecycle.spec.ts`, `tests/security-e2e/seminar-registration.spec.ts` — The browser specs run the real app and Stripe SDK against a local Stripe stand-in with webhooks signed by Stripe's own SDK; the Stripe-hosted payment page remains covered by the opt-in tests/stripe-e2e suite.
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.
- The staged deployment must be using Stripe test-mode credentials and have a published, fee-bearing test seminar; never use live-mode keys. Staging shares the production database, so cleanup is required.

### Steps
1. Reuse the run's ordinary-member account if it is still in a clean unpaid state; otherwise create one fresh member and reuse it for the paid membership and seminar steps.
2. Start membership checkout and return from Stripe without paying; confirm entitlement is not granted by the return redirect alone.
3. Pay with a Stripe test card and wait for the verified webhook; confirm entitlement becomes active exactly once.
4. Register for a seminar by each enabled payment method; for online payment complete Stripe test checkout and confirm the registration becomes paid once.
5. Confirm a full seminar and a seminar past its registration deadline reject registration with a clear message, and that cancellation updates My Seminars.
6. Confirm My Seminars/Courses shows both Payment Status and Registration Status (Confirmed for a non-FEI seminar, Pending FEI Approval for an FEI one), and that in a signed-out browser the seminar detail page offers no Register button or guest path.

### PASS
- Entitlement and seminar payment status change only after a verified provider event, never from browser redirects or client-supplied fields.
- Redelivered events do not double-credit.
- Capacity, deadline, disabled payment methods and unpaid-member restrictions are enforced server-side.
- Seminar/course registration is members-only: a signed-out or non-entitled visitor can browse details but cannot register by any route, and no guest or non-member pricing path exists.

### FAIL
- Entitlement or paid status is granted without a verified event, is granted twice, or a closed/full/disabled option accepts a registration.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-037 — A canceled membership works through its paid-through date and then ends the relationship: the session ends and sign-in is refused

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUTHZ-001, AUTH-AUTHZ-004, AUTH-AUTHZ-005, AUTH-SESSION-002
- **CI coverage:** mapped — `tests/checkout.integration.ts`, `tests/membership-cancellation.integration.ts`, `tests/security-e2e/membership-access-gate.spec.ts`, `tests/session-gate.test.ts`, `tests/status-actions.integration.ts`, `tests/stripe-webhook.integration.ts` — The browser spec drives self-service cancellation through the real UI and moves the paid-through date to prove both sides of the boundary; sign-in refusal is exercised through the real password form.
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.
- Use a disposable, paid-up member. Staging shares the production database, so cleanup is required.
- Moving the paid-through date requires administrator entitlement correction; record the original value first.
- Stripe test mode only: staging must use the test-mode keys and the communications and billing hold; never a live card.

### Steps
1. Sign in as the paid-up disposable member and cancel the membership from My Membership, confirming the dialog.
2. Confirm the member stays signed in with full access and My Membership shows when access ends.
3. Have an administrator move the paid-through date to yesterday (entitlement correction, with a reason).
4. Reload any page in the member's session and confirm it is signed out, then attempt password sign-in.
5. Have an administrator reverse the cancellation and confirm sign-in works again.
6. Before the cancellation, open Pay on My Membership and leave the Stripe Checkout page unpaid. After the administrator cancels (or suspends) the membership, complete that Checkout Session with a Stripe test card.
7. Confirm the membership status and paid-through date are unchanged, the payment is recorded, and a status_conflict reconciliation finding names the Checkout Session.
8. With the membership suspended (or review required), confirm Pay refuses to create a new Checkout Session.

### PASS
- Cancellation never removes access before the paid-through date and any Stripe subscription is set to end at period end.
- After the paid-through date the existing session ends and password sign-in is refused, with the canceled-membership message shown only after a correct password.
- An administrator's reversal restores sign-in.
- Completing a Checkout Session never reactivates or extends a canceled, suspended or review-held membership (pentest finding 5): the payment is recorded, entitlement is unchanged, a reconciliation finding is raised, and only the audited administrator reinstatement restores access.

### FAIL
- Access ends before the paid-through date, continues after it, or the refusal message is shown for an incorrect password or an unknown email.
- A payment reactivates a canceled, suspended or review-held membership, or extends its paid-through date, without an administrator's audited action.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-038 — An expired protected-page session returns the user to the same page after sign-in, and active use keeps an administrator signed in

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-SESSION-004, AUTH-SESSION-010
- **CI coverage:** mapped — `tests/canonical-session-lifecycle.test.ts`, `tests/general-navigation.test.ts`, `tests/member-launch-hold.integration.ts`, `tests/member-launch-hold.test.ts`, `tests/return-to-path.test.ts` — Unit tests cover the return-to path allow-list (protected same-origin paths only, no absolute or protocol-relative URLs) and the keep-alive wiring; the end-to-end return needs a real expired session and is exercised live.
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.
- Staging keeps DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING=true; only authentication OTP to this run's disposable @pixelsmith.space mailbox may be delivered.
- Use a disposable member account; an administrator account is optional for the idle-limit check.

### Steps
1. Sign in and open a deep protected page such as /dashboard/profile?tab=security.
2. Sign out in another tab (or let the session expire), then reload the first tab and confirm it lands on /sign-in.
3. Complete sign-in (password, email code and MFA as required) and confirm the browser returns to the original deep page.
4. Request /sign-in?next=https://example.com and a signed-out visit to /api/user, sign in, and confirm neither is used as a destination.
5. As an administrator, keep clicking and typing on a protected page for longer than the 30-minute idle limit and confirm the session stays valid.

### PASS
- Sign-in returns to the originally requested protected page exactly once; the remembered destination is cleared afterward and never points outside /dashboard, /admin, or /onboarding.
- An actively used privileged session is not signed out by the idle limit, while an untouched one still expires.

### FAIL
- Sign-in lands on a different page after a protected-page redirect, honors an off-site or non-protected destination, reuses a stale destination on a later sign-in, or signs out an actively used session.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-039 — Imported WordPress passwords failing the current policy require a verified reset; compliant ones upgrade seamlessly

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-STORAGE-004, AUTH-PASSWORD-005, AUTH-IDENTITY-003
- **CI coverage:** mapped — `tests/legacy-wordpress-hash.test.ts`, `tests/password-composition-policy.test.ts`, `tests/security-e2e/password-recovery-and-change.spec.ts`, `tests/token-password-redirect.test.ts` — Credential-format and policy checks run in CI, including the contract that a successful activation-link submit redirects to /sign-in with a flash notice instead of leaving the form on screen; the disposable WordPress fixture, real activation email and first-login browser lifecycle run against staging.
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Run against staging.idoc.club with DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING=true and the staging-only authentication email exception enabled.
- Provision two new disposable @pixelsmith.space mailboxes, and atomically seed corresponding migrated_pending members, current membership entitlements, professional-role/profile records and migration mappings only in idoc_staging.
- Use a supported, verifiable WordPress bcrypt hash for each: one policy-noncompliant and one policy-compliant password. Never reuse real member accounts.

### Steps
1. Successfully enter the noncompliant imported WordPress password. Verify the explicit IDOC password-policy explanation and absence of a valid session.
2. Receive a real activation link at the disposable mailbox, open it, set a compliant password, and verify successful activation.
3. Try the original noncompliant password again and verify it is rejected.
4. Successfully enter the compliant imported WordPress password and verify the ordinary email OTP, first-login activation, and profile/onboarding destination without a mandatory reset.
5. Use a separate disposable breached-password fixture in a follow-up acceptance run to confirm the breach-specific explanation takes precedence if both checks fail.

### PASS
- Policy-noncompliant verified WordPress credentials never establish a session without replacing their password through the received, single-use email link.
- The old credential fails after replacement and a compliant imported WordPress credential proceeds without mandatory reset.

### FAIL
- Noncompliant imported password creates a session, its required-reset explanation is missing, no activation email arrives, the old password remains accepted after reset, or a compliant legacy credential is unnecessarily forced to reset.

### Cleanup
- Neutralize only the disposable staging accounts through the authorized e2e cleanup helper; delete both disposable mailboxes.

### Evidence
- Capture browser assertion results, delivery of the activation link, the staging revision, OTP and final destination. Never log or retain raw hashes, passwords, activation tokens or mailbox credentials.

## LIVE-AUTH-040 — A pre-issued email-verification link cannot undo a suspension or deletion, rebind the login email afterward, or promote a legacy account

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-EMAIL-003, AUTH-AUTHZ-004, AUTH-SESSION-008
- **CI coverage:** mapped — `tests/email-change.integration.ts`, `tests/account-suspension.integration.ts`, `tests/member-lifecycle.integration.ts` — Real-Postgres integration tests suspend, delete and migrated_pending-mark an account holding a captured verification token and prove redemption is refused, the link is burned and the account is untouched; suspension, self-deletion and bulk archive retire outstanding links.
- **Live:** required; email=yes; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.
- Use a disposable member with a password and a second disposable mailbox for the new address.
- An administrator is needed to suspend and reinstate the disposable member.

### Steps
1. As the disposable member, request a login email change to the second mailbox (with the current password) and capture the verification link from that mailbox without opening it.
2. As an administrator, suspend the member.
3. Open the captured link and confirm the page reports the link unavailable.
4. Confirm the member is still suspended, the login email is unchanged, and the old address still cannot sign in.
5. Reinstate the member and confirm the link is still dead (it was burned or retired by the suspension).
6. Open /verify-email with an invalid token and confirm no session cookie is issued by the page.

### PASS
- A verification link issued before an administrative suspension or self-service deletion is refused and burned; the suspension holds, the login identity does not move, and /verify-email never starts a session (pentest finding 4).

### FAIL
- Opening the pre-issued link lifts the suspension, restores a deleted account, rebinds the login email, or sets a session cookie.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-041 — Anonymous endpoints that cause email cannot be driven by unauthenticated callers beyond shared limits, and cannot carry caller-chosen text to staff

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-RATE-001, AUTH-RATE-005, AUTH-OPERATIONS-006
- **CI coverage:** mapped — `tests/admin-event-notifications.test.ts`, `tests/authorization-boundary-inventory.test.ts`, `tests/membership-foundation.test.ts` — Unit tests prove the alert path takes only a same-host plain path and a character-restricted browser string, that the route applies the shared database limiter per caller and deployment-wide, and that the unauthenticated resendVerification action no longer exists; the cross-instance volume behaviour needs the deployed platform.
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.
- The Technical Support recipient mailbox must be a disposable @pixelsmith.space address for the run so alert content can be inspected.

### Steps
1. POST to /api/client-error repeatedly (at least 15 times within a few minutes, including from concurrent connections) with a hostile Referer such as a sentence containing a URL and a hostile User-Agent.
2. Confirm every response is HTTP 200 with a correlation requestId (the caller is never blocked from its reference).
3. Inspect the Technical Support mailbox: confirm the number of alerts stays within the shared limit (per caller address and deployment-wide) rather than scaling with concurrency, and that no alert subject or body contains the hostile Referer or User-Agent text.
4. Confirm there is no anonymous way to trigger an email-verification email (the old resendVerification action is gone): signup, login and recovery sends remain bound to their rate-limited OTP flows.

### PASS
- Alert volume from anonymous client-error reports is bounded by the shared database limiter, the page named in an alert is a same-site path or absent, and no caller-chosen text reaches the alert subject or body (pentest findings 2 and 3).

### FAIL
- Alert volume scales with concurrent requests, an alert carries caller-chosen Referer or User-Agent text, or an unauthenticated caller can trigger a verification email.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-042 — Rich-text content cannot inject live markup into public pages or transactional emails

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-HEADER-001, AUTH-AUTHZ-005
- **CI coverage:** mapped — `tests/rich-text-sanitizer.test.ts`, `tests/news-articles.test.ts`, `tests/organization-settings.test.ts`, `tests/seminars.test.ts` — Unit tests prove stray, unterminated, underscore-named, comment and processing-instruction markup is escaped by both sanitizers, that sanitizing twice is stable, and that ordinary editor HTML is unchanged; rendering in a real browser and the deployed CSP are verified live.
- **Live:** required; email=no; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.
- An administrator saves a disposable, unpublished article; delete it afterward.

### Steps
1. As an administrator, save an unpublished article whose HTML contains an unterminated image tag with an event handler, an underscore-named tag (<img_x onerror=...>), a comment opener and a meta refresh.
2. Publish it to a staging-only slug, open the public page as an anonymous visitor, and inspect the DOM.
3. Confirm the payloads appear as visible text, no img/meta/div_x element with those attributes exists, and the browser is not redirected.
4. Confirm ordinary formatting (headings, bold, lists, links, an image) in the same article still renders normally.

### PASS
- Unrecognised markup is shown as text and never becomes an element, while normal WYSIWYG formatting is preserved (pentest finding 6).

### FAIL
- Any injected element, handler attribute or redirect appears in the rendered page or an email body, or normal formatting is lost.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.
- Delete the disposable article.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.
