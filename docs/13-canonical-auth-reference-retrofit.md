# Canonical authentication reference retrofit

This document tracks IDOC's retrofit to the canonical authentication implementation reference in `marceloATpixelsmith/pixelsmith-auth-reference`. It supplements the existing IDOC security requirements while the retrofit is in progress. If an older authentication-specific statement in another IDOC document conflicts with the current canonical authentication contract, the canonical contract governs the retrofit and the conflicting IDOC documentation must be corrected in the same implementation work.

## Canonical baseline

Reference repository: `marceloATpixelsmith/pixelsmith-auth-reference`

Current reference `main` inspected through commit `b6aa39aa0868dd86483c40ff168a7bd26a7dea68`.

Baseline inspected for this retrofit:

- contract `1.8.0`
- machine schema `12.0.0`
- validator `9.0.0`
- mapping schema `1.0.0`
- portable-config schema `2.0.0`

The machine contract under `src/contract/` is authoritative. IDOC remains responsible for implementing the reference's trusted-server requirements in its own Next.js, Drizzle/PostgreSQL, Vercel, email, and provider architecture.

## IDOC application model

IDOC uses the canonical single-application role model:

- Member
- Admin
- Super Admin

Professional member classifications such as Judge, Steward, Combo Judge/Steward, and Veterinarian are membership-domain attributes, not authentication roles. They must never grant administrator authority.

Existing member IDs, imported legacy mappings, Stripe customer/subscription relationships, membership status, and billing history are preserved by the authentication retrofit unless a separately reviewed migration explicitly requires a change.

## Retrofit status

The retrofit is **not complete** and IDOC must not be described as conformant to the canonical authentication reference until the remaining gaps have implementation and test evidence.

### First security-alignment slice

The initial slice corrects four existing contradictions with the canonical contract:

1. **Turnstile Siteverify binding.** Auth flow-entry challenges are now submitted with a stable action name. Trusted server verification requires provider `success`, the hostname derived from trusted `BASE_URL`, and the exact expected action. Provider failure and mismatches fail closed. The client challenge remains untrusted evidence and never establishes authentication authority.
2. **Login anti-enumeration.** The first login email step no longer reveals whether an account exists or whether it is suspended. Password verification keeps a generic failure for unknown or ineligible accounts, while imported members that still require one-time email-control verification are handled inside the normal sign-in route rather than through a separately advertised activation entry point.
3. **Email OTP lifetime.** Signup, password-reset, and retained login-verification OTPs now expire after 15 minutes, matching the canonical 900-second transaction/verification lifetime. Attempt caps, single-use behavior, resend replacement, and rate limiting remain in force.
4. **Password policy and storage migration.** New password-setting paths use the canonical 12–128 character policy without composition rules and store credentials in a versioned Argon2id format. Existing bcrypt credentials remain valid only as a migration format and are rehashed to Argon2id after successful verification, preserving existing-member access while moving credentials forward.

Canonical requirement families directly implicated by this slice include `AUTH-BOT-*`, `AUTH-RATE-*`, `AUTH-TRANSACTION-*`, `AUTH-EMAIL-*`, `AUTH-IDENTITY-*`, `AUTH-PASSWORD-*`, `AUTH-STORAGE-*`, and `AUTH-OPERATIONS-*` as defined by the current machine contract.

### Second security-alignment slice: authorization boundary cleanup

The second slice removes two inherited subscription-starter Server Actions, `inviteTeamMember` and `removeTeamMember`, from the authentication action module. Those actions operated on the legacy `teams`, `team_members`, and `invitations` compatibility tables and authorized only through a normal authenticated-account boundary. They did not represent IDOC's canonical Member/Admin/Super Admin authorization model and could therefore create or remove legacy team membership without a corresponding IDOC application-role authorization decision.

IDOC's production authorization model does not use legacy subscription-starter team ownership as authentication or administrator authority. The compatibility `/api/team` route remains deliberately disabled, and legacy team mutation actions are no longer exported or callable as Server Actions. A regression test now fails if either legacy mutation action, or its team/invitation dependencies, is reintroduced into the authentication action module.

Privileged IDOC application-role changes are already restricted to Super Admins and audited. This slice additionally increments the target account's server-owned `sessionVersion` in the same transaction as every Administrator or Super Admin grant/revocation. Because authenticated-user resolution rejects signed sessions whose embedded version no longer matches the authoritative account version, pre-change sessions for the target are invalidated immediately after the role change. This prevents a privilege grant from silently upgrading an existing lower-assurance session and prevents a revoked privileged session from retaining authority until natural expiry.

This closes the discovered legacy-team mutation path and stale-role-session path under the canonical requirements that authentication and authorization remain distinct, client-visible or compatibility role concepts are not authoritative, protected mutations require trusted server authorization, and privilege changes rotate or revoke existing authority (`AUTH-AUTHZ-*`, `AUTH-FRAMEWORK-*`, and `AUTH-SESSION-*`). It does **not** yet implement the final canonical privileged-invitation flow or the full canonical session lifecycle; those remain separate work.

### Login-surface correction for imported members

Imported members no longer receive a separate public activation choice on the sign-in screen. Every member starts at the same `/sign-in` entry surface. The anonymous email-entry boundary is account-state neutral: after Turnstile and rate-limit checks, every syntactically valid email advances to the same login-verification OTP screen, while only an eligible account actually receives a code. OTP delivery, cooldown, and account-state distinctions are not reflected in the anonymous response.

Only after successful possession of the emailed code does the trusted server inspect account state to choose the continuation. An ordinary eligible member continues to normal password entry; a `migrated_pending` imported member continues to the one-time password-establishment step. The user-facing copy is migration-neutral. The pre-existing `/request-activation` email-link route is retained only as an unlinked compatibility/support fallback for legacy activation links; it is not advertised or linked anywhere in the normal sign-in flow.

This preserves migration safety checks and imported-profile foundation validation while matching the canonical reference's single visible login surface and anti-enumeration requirements. There is no user-visible “Migrated member?” branch on the login page.

## Remaining retrofit work

The following areas require a subsequent gap analysis and implementation evidence before the retrofit can be considered complete:

- canonical session lifecycle, rotation, absolute/idle limits, individual revocation, session inventory, cookie contract, and session-key rotation semantics while preserving existing-user continuity;
- complete MFA policy implementation, including required TOTP enrollment/challenge behavior for applicable privileged roles;
- recovery codes, authenticator replacement/re-enrollment, and remembered-device behavior;
- fresh sensitive-action step-up for privileged/security-sensitive actions;
- full server-owned authentication transaction semantics and replay/atomic-consumption evidence across every flow;
- CSRF verification against the canonical contract for all cookie-authenticated unsafe mutations;
- canonical Super Admin-only privileged invitation lifecycle and acceptance flow using IDOC application roles rather than legacy team roles;
- remaining authorization review against current `AUTH-AUTHZ-*` requirements, including direct-handler and resource-level negative tests;
- audit/security-event coverage required by the canonical logging, lifecycle, incident, and key/secret requirements;
- complete canonical UI/flow comparison and route/configuration mapping;
- production provider/configuration evidence, failure-mode tests, concurrency/replay tests, and final `AUTH-*` requirement matrix.

The final requirement matrix must cite concrete implementation, automated-test, and operational evidence rather than treating documentation statements alone as proof of conformance.

## Completion criterion

The strongest allowed status before the final audit is **not ready**.

After every applicable canonical requirement has implementation/test/operational evidence and no unresolved production security blocker remains, the project may advance to the verdict **ready for application-specific production validation**. Following the reference never by itself constitutes compliance certification or proof that the deployed application is secure.
