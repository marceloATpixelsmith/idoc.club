# Authentication Test Coverage Matrix

Generated from `tests/auth/auth-test-matrix.json`.

Summary: **33 cases** — CI mapped 30, CI gaps 2, not applicable 1.

| ID | Requirement | CI | Live staging | Canonical controls |
|---|---|---|---|---|
| LIVE-AUTH-001 | Email/password signup succeeds and establishes the correct initial account state | mapped | required | AUTH-IDENTITY-003, AUTH-EMAIL-001 |
| LIVE-AUTH-002 | Signup rejects duplicate/invalid identities without account enumeration | mapped | required | AUTH-IDENTITY-003, AUTH-ERROR-001 |
| LIVE-AUTH-003 | Password login accepts valid credentials and rejects invalid/unknown credentials safely | mapped | required | AUTH-STORAGE-004, AUTH-ERROR-001, AUTH-RATE-001 |
| LIVE-AUTH-004 | Google OAuth live flow preserves transaction binding and account-linking rules | mapped | required | AUTH-OAUTH-002, AUTH-TRANSACTION-010, AUTH-IDENTITY-005 |
| LIVE-AUTH-005 | Logout and session invalidation prevent post-logout reuse | mapped | required | AUTH-SESSION-002, AUTH-SESSION-009, AUTH-SESSION-010 |
| LIVE-AUTH-006 | Anonymous and incomplete-auth sessions cannot access protected pages or APIs | mapped | required | AUTH-AUTHZ-001, AUTH-FRAMEWORK-001, AUTH-API-004 |
| LIVE-AUTH-007 | Unpaid/expired member access is restricted to the intended payment/membership flow | mapped | required | AUTH-AUTHZ-001 |
| LIVE-AUTH-008 | Onboarding cannot be skipped or corrupted by direct navigation/query manipulation | mapped | required | AUTH-AUTHZ-001, AUTH-TRANSACTION-002 |
| LIVE-AUTH-009 | Required TOTP enrollment cannot be bypassed and produces a usable factor | mapped | required | AUTH-MFA-001, AUTH-MFA-002 |
| LIVE-AUTH-010 | Pending-MFA login state is isolated from fully authenticated authority | mapped | required | AUTH-MFA-002, AUTH-MFA-006 |
| LIVE-AUTH-011 | Recovery codes are single-use, bound to the intended account, and regeneration invalidates old codes | mapped | required | AUTH-MFA-006, AUTH-STORAGE-006 |
| LIVE-AUTH-012 | Remembered-device trust is scoped and does not bypass fresh step-up | mapped | required | AUTH-REMEMBER-001, AUTH-REMEMBER-002, AUTH-REMEMBER-003, AUTH-REMEMBER-004 |
| LIVE-AUTH-013 | Fresh MFA step-up automatically resumes the original programmed action exactly once | mapped | required | AUTH-MFA-006, AUTH-TRANSACTION-003, AUTH-TRANSACTION-004 |
| LIVE-AUTH-014 | Password change enforces current authority and invalidates the old credential as designed | mapped | required | AUTH-PASSWORD-005, AUTH-LIFECYCLE-002 |
| LIVE-AUTH-015 | Password reset tokens are non-enumerating, single-use, expiring, and actually replace the credential | mapped | required | AUTH-TRANSACTION-003, AUTH-STORAGE-005 |
| LIVE-AUTH-016 | Email change preserves identity uniqueness and requires the intended verification/step-up | mapped | required | AUTH-IDENTITY-003, AUTH-IDENTITY-005 |
| LIVE-AUTH-017 | Role boundaries and object ownership resist direct URL/API ID tampering | mapped | required | AUTH-AUTHZ-001, AUTH-AUTHZ-005, AUTH-API-004 |
| LIVE-AUTH-018 | CSRF defenses reject forged state-changing requests without damaging the valid session | mapped | required | AUTH-CSRF-003 |
| LIVE-AUTH-019 | Session fixation, token tampering, stale-session replay, and revoked-session reuse fail closed | mapped | required | AUTH-SESSION-002, AUTH-SESSION-009, AUTH-SESSION-010 |
| LIVE-AUTH-020 | Rate limits resist trivial identity/origin normalization bypass and recover according to policy | mapped | required | AUTH-RATE-001, AUTH-RATE-004 |
| LIVE-AUTH-021 | Turnstile/bot controls fail closed when required and cannot be bypassed by direct API calls | mapped | required | AUTH-BOT-001, AUTH-BOT-002 |
| LIVE-AUTH-022 | Redirect and callback parameters cannot escape approved application destinations | mapped | required | AUTH-TRANSACTION-010, AUTH-OAUTH-002 |
| LIVE-AUTH-023 | Server-side validation rejects request/input tampering independent of the UI | mapped | required | AUTH-API-004, AUTH-AUTHZ-005 |
| LIVE-AUTH-024 | One-time auth operations resist replay and bounded concurrency races | mapped | required | AUTH-TRANSACTION-003, AUTH-TRANSACTION-004, AUTH-MFA-006 |
| LIVE-AUTH-025 | Cookies, HTTPS, caching, CSP/frame protections, and security headers match production expectations | mapped | required | AUTH-SESSION-001, AUTH-TRANSPORT-001, AUTH-FRAMEWORK-001 |
| LIVE-AUTH-026 | Security/audit evidence is recorded without secret/token leakage | mapped | required | AUTH-AUDIT-002, AUTH-LOG-001, AUTH-LOG-003 |
| LIVE-AUTH-027 | Authentication dependencies and internal failures fail closed with safe user-facing errors | mapped | required | AUTH-ERROR-001, AUTH-DEPENDENCY-001 |
| LIVE-AUTH-028 | Authorized adversarial sweep finds no bypass across auth, MFA, authorization, replay, CSRF, or identity binding | mapped | required | AUTH-AUTHZ-001, AUTH-MFA-006, AUTH-CSRF-003, AUTH-SESSION-010 |
| LIVE-AUTH-029 | Real transactional email dependency works end to end on staging | mapped | required | AUTH-EMAIL-002 |
| LIVE-AUTH-030 | Live test environment is the intended staged deployment and evidence is revision-bound | gap | required | AUTH-OPERATIONS-011 |
| LIVE-AUTH-031 | Cleanup and failure preservation are deterministic and auditable | gap | required | AUTH-OPERATIONS-011 |
| LIVE-AUTH-032 | Invitation auth testing is explicitly not applicable to the current product model | na | N/A | AUTH-INVITE-001, AUTH-INVITE-002, AUTH-INVITE-003 |
| LIVE-AUTH-033 | Ordinary member sessions use a 7-day idle timeout and 14-day absolute lifetime while privileged sessions retain strict limits | mapped | required | AUTH-SESSION-005, AUTH-SESSION-010 |
