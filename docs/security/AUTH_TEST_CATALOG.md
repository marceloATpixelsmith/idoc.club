# Authentication & Security Test Catalog

**Authoritative source:** `tests/auth/auth-test-matrix.json`. This document is generated from that file. Do not edit pass/fail criteria here independently.

## Operating model

CI and live staging are two execution layers for the same requirements. CI proves deterministic repository-controlled behavior; live staging proves deployment, browser, real-provider, real-email, cookie/domain, and operational behavior. Results must always use the same `LIVE-AUTH-###` IDs.

A defect is not fully regression-covered until it maps to one of these IDs (or a new ID is added), has CI coverage where technically possible, and has live coverage when the failure depends on deployment/provider/runtime behavior.

## LIVE-AUTH-001 — Email/password signup succeeds and establishes the correct initial account state

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-IDENTITY-003, AUTH-EMAIL-001
- **CI coverage:** mapped — `tests/email-identity-normalization.integration.ts`, `tests/auth-email-resend-safety.integration.ts`
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Create a fresh Pixelsmith E2E mailbox.
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
- **CI coverage:** mapped — `tests/email-identity-normalization.integration.ts`, `tests/auth-error-classes.integration.ts`, `tests/rate-limit-normalization.integration.ts`
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
- **CI coverage:** mapped — `tests/password-hash.test.ts`, `tests/auth-error-classes.integration.ts`, `tests/rate-limit-normalization.integration.ts`
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
- **CI coverage:** mapped — `tests/security-e2e/google-oauth.spec.ts`, `tests/identity-ownership.integration.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Complete a real Google sign-in against staging.
2. Cancel/deny consent and verify return behavior.
3. Replay or alter callback/state parameters only within the disposable test flow.
4. Verify an existing password account is not silently linked to the wrong Google identity.

### PASS
- Successful OAuth creates/reuses only the intended identity; cancelled flow returns safely; tampered/replayed callbacks fail; no unintended account linking occurs.

### FAIL
- State/callback replay succeeds, cancellation lands incorrectly, or Google identity becomes attached to the wrong account.

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

## LIVE-AUTH-007 — Unpaid/expired member access is restricted to the intended payment/membership flow

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUTHZ-001
- **CI coverage:** mapped — `tests/security-e2e/auth-boundaries.spec.ts`, `tests/security-e2e/dashboard-membership-tabs.spec.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Authenticate as an unpaid/expired disposable member.
2. Confirm the first authenticated screen is the intended payment/membership state.
3. Directly request ordinary member dashboard routes and APIs.
4. After test payment/state transition, verify access updates.

### PASS
- Unpaid/expired users cannot bypass entitlement restrictions; payment flow is reachable directly; post-payment entitlement updates correctly.

### FAIL
- Protected member content is accessible before entitlement or the user is trapped behind an unnecessary/incorrect intermediate state.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-008 — Onboarding cannot be skipped or corrupted by direct navigation/query manipulation

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUTHZ-001, AUTH-TRANSACTION-002
- **CI coverage:** mapped — `tests/security-e2e/auth-boundaries.spec.ts`
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
- Required earlier state cannot be skipped; invalid query values are rejected/ignored safely; refresh/back preserves a coherent state.

### FAIL
- Direct navigation grants access/state that should require a prior onboarding step.

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
- **CI coverage:** mapped — `tests/canonical-mfa-runtime.test.ts`, `tests/production-mfa-finalization.integration.ts`
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
- **CI coverage:** mapped — `tests/fresh-mfa-step-up.test.ts`, `tests/security-e2e/mfa-production-boundaries.spec.ts`
- **Live:** required; email=no; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. For each sensitive action in the documented matrix, initiate the action without recent step-up.
2. Submit a wrong TOTP and verify no mutation.
3. Submit a valid TOTP once.
4. Do not click the original action a second time; inspect the resulting state/network activity.
5. Replay refresh/back/callback state after completion.

### PASS
- Wrong code is inert; valid TOTP causes the programmed original action to resume automatically exactly once; no second user click is needed; replay does not repeat the mutation.

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
- **CI coverage:** mapped — `tests/account-security-management.test.ts`, `tests/password-security-hardening.test.ts`
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
- **CI coverage:** mapped — `tests/password-reset-adversarial.integration.ts`, `tests/account-token-lifecycles.integration.ts`
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Request a reset for a disposable account and for an unknown address.
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

## LIVE-AUTH-016 — Email change preserves identity uniqueness and requires the intended verification/step-up

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-IDENTITY-003, AUTH-IDENTITY-005
- **CI coverage:** mapped — `tests/email-change.integration.ts`, `tests/email-identity-normalization.integration.ts`
- **Live:** required; email=yes; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Change a disposable account to a new E2E mailbox.
2. Attempt a duplicate existing address and case/whitespace equivalent.
3. Complete any real verification step.
4. Test login/identity behavior at old and new addresses.

### PASS
- Change requires intended authority/verification; duplicate normalized identities are rejected; resulting login identity is unambiguous.

### FAIL
- Email can be changed to an existing normalized identity or without required verification/step-up.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-017 — Role boundaries and object ownership resist direct URL/API ID tampering

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-AUTHZ-001, AUTH-AUTHZ-005, AUTH-API-004
- **CI coverage:** mapped — `tests/authorization-boundary-inventory.test.ts`, `tests/authorization-matrix.integration.ts`, `tests/authorization-privilege-boundaries.integration.ts`, `tests/security-e2e/api-authorization-disclosure.spec.ts`
- **Live:** required; email=no; admin=yes; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. As a normal member, directly request admin routes/APIs.
2. As an administrator, alter target user/member IDs to another account and attempt out-of-scope actions.
3. Attempt self-elevation or role mutation outside permitted scope.

### PASS
- Every server-side boundary rejects unauthorized role/object access with 401/403 or equivalent safe denial; no protected data or mutation occurs.

### FAIL
- Hidden UI is the only boundary, object ID substitution works, or a user can elevate privileges.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-018 — CSRF defenses reject forged state-changing requests without damaging the valid session

- **Risk:** critical
- **Applicability:** applicable
- **Canonical controls:** AUTH-CSRF-003
- **CI coverage:** mapped — `tests/security-e2e/csrf.spec.ts`, `tests/pending-flow-csrf-nonce.integration.ts`
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
- **CI coverage:** mapped — `tests/session-registry-adversarial.integration.ts`, `tests/security-e2e/session-replay.spec.ts`, `tests/session-token-boundaries.test.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Capture pre-login and post-login session state.
2. Verify session rotation/authority transition.
3. Attempt safe replay of stale/revoked/tampered session material only on disposable accounts.

### PASS
- Authentication does not preserve attacker-controlled pre-auth authority; stale/revoked/tampered sessions are rejected by protected resources.

### FAIL
- A stale, revoked, or tampered session grants authenticated authority.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-020 — Rate limits resist trivial identity/origin normalization bypass and recover according to policy

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-RATE-001, AUTH-RATE-004
- **CI coverage:** mapped — `tests/rate-limit-normalization.integration.ts`, `tests/rate-limit-correlation.integration.ts`
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
- **CI coverage:** mapped — `tests/turnstile-contract.test.ts`, `tests/turnstile-retry-restore.test.ts`, `tests/turnstile-widget-resilience.test.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Run the normal human flow.
2. Where safely possible, submit without/with invalid Turnstile proof or invoke the protected API directly.
3. Verify the UI recovers from a failed challenge without losing unrelated form state.

### PASS
- Required bot proof is enforced server-side; invalid/missing proof fails closed; normal challenge succeeds; retry UX remains usable.

### FAIL
- API bypass skips required bot validation or provider/challenge failure silently allows the protected action.

### Cleanup
- Remove disposable state only after evidence is captured; preserve failed-flow state when needed for debugging.

### Evidence
- Record URL, role, action, HTTP status, relevant screenshot/trace, and any console/network error. Never record secrets.

## LIVE-AUTH-022 — Redirect and callback parameters cannot escape approved application destinations

- **Risk:** high
- **Applicability:** applicable
- **Canonical controls:** AUTH-TRANSACTION-010, AUTH-OAUTH-002
- **CI coverage:** mapped — `tests/security-e2e/google-oauth.spec.ts`
- **Live:** required; email=no; admin=no; destructive=no

### Preconditions
- Use the designated staged/live hostname, never a Vercel preview or localhost.
- Use only disposable test identities and test data.

### Steps
1. Manipulate safe return/callback parameters with external, protocol-relative, encoded, and malformed destinations.
2. Complete/cancel auth flows using those values.

### PASS
- External/unapproved destinations are rejected or normalized to safe internal locations; auth transaction binding remains intact.

### FAIL
- Authentication can redirect to an attacker-controlled external destination or callback manipulation changes account binding.

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
- **CI coverage:** mapped — `tests/auth-security-events.integration.ts`, `tests/security-event-log-attribution.integration.ts`, `tests/security-event-taxonomy.integration.ts`, `tests/audit-evidence.integration.ts`
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
- **CI coverage:** mapped — `tests/auth-error-classes.integration.ts`, `tests/dependency-risk-register.test.ts`, `tests/google-oauth-failure-alerting.test.ts`
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
1. Use the Pixelsmith E2E Email connector to create a mailbox.
2. Exercise signup/reset/email-change flows that cause the staged app itself to send mail.
3. Poll the mailbox, verify the intended message/link/code, and continue the real browser flow.

### PASS
- The staged app emits the expected real email and the received link/code successfully completes only the intended flow.

### FAIL
- App reports success but no email arrives, wrong recipient/content is sent, or link/code fails/binds to the wrong purpose.

### Cleanup
- Delete the E2E mailbox only after the corresponding flow passes; preserve failed-flow mailboxes temporarily for debugging.

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
