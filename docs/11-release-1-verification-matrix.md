# Release 1 behavioral verification matrix

## Status and evidence rules

This matrix records the verification available on this branch. **Release 1 remains open.** A row is `Verified` only when the named test exercises the behavior against isolated PostgreSQL and the command passed. Unit tests and source inspection are listed only as supplemental evidence and never turn a database requirement green. `Not yet verified` is an acceptance blocker, not an assertion that the implementation is defective.

The implementation boundaries use these abbreviations: `migration` = `lib/db/migrations` and Drizzle metadata; `DB guard` = `lib/db/test-database-url.ts` and `scripts/run-integration-db.ts`; `membership` = `lib/membership`; `delivery` = `lib/notifications`; `auth` = `lib/auth` plus login actions; `configuration` = `lib/runtime/configuration.ts`.

## PostgreSQL-backed evidence currently present

| Requirement | PostgreSQL behavioral test | Boundary | Result |
|---|---|---|---|
| All migrations apply to an empty database | `Drizzle applies every migration to an empty isolated database` | migration | Blocked locally: `pnpm test:integration-db` could not provision PostgreSQL because Docker is unavailable and no `TEST_DATABASE_URL` was supplied |
| Upgrade from migration `0004` | `Drizzle applies account-delivery migrations to a database already at 0004` | migration | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Upgrade from the originally released `0007` | `forward migration preserves databases that already applied released migration 0007` | migration | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Re-execution does not duplicate migration ledger rows | `migration re-execution is safe and does not duplicate objects` | migration | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Journal order, immutable released `0007` timestamp, and migrated snapshot columns | `generated migration metadata agrees with the migrated schema` | migration/schema | Blocked locally by unavailable PostgreSQL; exact constraints/defaults/index parity also remains open below |
| Dedicated `idoc` schema | All migration tests query `idoc.__drizzle_migrations` and `idoc` tables | migration | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Normalized unique email and one profile per user | `migrations enforce normalized unique identities and one profile per user` | database constraints | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Token digest uniqueness and conditional single-use update | `token digests are unique and one-time state is database-backed` | token persistence | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Audit rows reject update and delete | `audit and profile history records are immutable` | immutable triggers | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Profile-history rows reject update and delete | `audit and profile history records are immutable` | immutable triggers | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Purpose-separated concurrent rate-limit increments | `rate-limit buckets are purpose-specific and concurrent increments are not lost` | request-limit persistence | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Two workers cannot claim one row | `two workers cannot claim one outbox row and an expired lease is reclaimable` | outbox lease SQL | Blocked locally by unavailable PostgreSQL; the pool is configured for multiple connections |
| Expired lease can be reclaimed | same test | outbox lease SQL | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Different pending rows can be claimed concurrently | `outbox lease ownership prevents stale finalization and delivered rows are not reclaimed` | outbox lease SQL | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Live lease cannot be stolen | same test | outbox lease SQL | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Only lease owner may finalize; stale owner is denied | same test | outbox finalization SQL | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Delivered row is not reclaimed | same test | outbox claim SQL | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Expired, consumed, missing, wrong-user, and wrong-purpose tokens are terminalized and not leased | `account delivery atomically terminalizes ineligible tokens and leases only a usable match` | eligibility/claim SQL | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Delivery does not consume the token | same test | token/outbox boundary | Blocked locally: Docker is unavailable and no explicit isolated `TEST_DATABASE_URL` was supplied |
| Account suspension and current entitlement remain independent database facts | `account states and current entitlement remain independent database facts` | schema/account policy | Blocked locally by unavailable PostgreSQL; the access decision also remains open below |

## Open requirement-level behavioral coverage

Every item below is `Not yet verified` by a real PostgreSQL behavioral test. Existing unit/source assertions may be useful regression checks, but are not acceptance evidence.

### Migration safety and schema agreement

| Requirement | Needed test and implementation boundary | Result |
|---|---|---|
| Exact final schema parity, including types, defaults, nullability, constraints, indexes, foreign keys, triggers, and enum/check semantics | Catalog comparison against `schema.ts` and `0008_snapshot.json` (`migration`) | Not yet verified |
| Released migration and snapshot immutability beyond the recorded `0007` timestamp | Committed checksum manifest (`migration`) | Not yet verified |
| Destructive SQL occurs only after target validation | Instrumented harness test (`DB guard`) | Not yet verified |
| Reject production, Render, ambiguous and malformed destinations before mutation | Sentinel-schema PostgreSQL harness test (`DB guard`) | Not yet verified |
| Credentials, scheme aliases, query/SSL decoration, host case, percent encoding and default/omitted ports cannot bypass same-target detection | Unit coverage exists; destructive sentinel PostgreSQL test is required (`DB guard`) | Not yet verified |

### Identity, ownership, states, and authorization

Behavioral verification batch 1 adds focused isolated-PostgreSQL suites and the shared
`tests/postgres-harness.ts` fixture/graph helper. The application boundaries named below
are invoked directly with a test-only, server-resolved actor context; claimed roles are
deliberately ignored in favor of persisted `application_roles`. These rows remain open
until the latest pull-request-head `Run Release 1 gate` workflow reports success.

| Requirement | Needed PostgreSQL behavioral test and boundary | Result |
|---|---|---|
| Owner private-profile read/update succeeds; cross-account read/update and lower-level bypass fail | `real profile boundaries allow owners and deny cross-account reads, writes, and entitlement bypasses` invokes `getOwnPrivateMember`, `getPrivateMember`, `updateMemberProfile`, and `hasCurrentMemberEntitlement` (`membership/data-access`) | Added; latest PR-head GitHub Actions result pending |
| Email change preserves user/profile/roles/membership/billing/Stripe/history/migration mapping | Seed complete graph, change email through server function, compare every identity (`membership`) | Not yet verified |
| Activation never duplicates user/profile; registration/onboarding neither creates nor needs starter teams | Invoke flows and count persisted graph (`auth`, `membership`) | Not yet verified |
| Eligible unverified verification enters onboarding; eligible onboarding profile creation transitions atomically to active | Invoke flows with persisted state (`email-verification`, `data-access`) | Not yet verified |
| Ineligible first-profile creation is denied | Persist each ineligible state and invoke onboarding (`data-access`) | Not yet verified |
| Current member access and expired-member limited account/profile/payment/renewal access | `persisted account-state and entitlement matrix is enforced at the direct server boundary` invokes `requireAccountAccess` (`data-access`, `account-access`) | Added; latest PR-head GitHub Actions result pending |
| Suspended, migrated-pending, unverified and deleted users are denied as specified | Same table-driven PostgreSQL test invokes `requireAccountAccess` for every access class | Added; latest PR-head GitHub Actions result pending; migrated activation itself remains outside this batch |
| Administrator and Super Admin receive only approved access | `administrator and Super Admin access comes only from persisted grants` and `server-managed grants permit administrator ownership override and ignore claimed actor roles` invoke `requireAccountAccess`/`getPrivateMember` | Added; latest PR-head GitHub Actions result pending |
| Member cannot self-escalate | Persist member, submit role mutation, compare grants (`data-access`) | Not yet verified |
| Browser-supplied state, roles, entitlement, classification, membership, billing, and Stripe values are ignored | Persisted-state matrix and claimed-role ownership tests invoke the direct boundary; broader malicious-field mutation coverage remains open | Partially covered; not Verified |
| Middleware/UI bypass cannot bypass server authorization | Direct server-function invocation (`authorization`, `data-access`) | Not yet verified |

### Profiles, roles, transactions, and operational evidence

| Requirement | Needed PostgreSQL behavioral test and boundary | Result |
|---|---|---|
| Judge, Steward, combined Judge + Steward, and Veterinarian creation/validation | `onboarding validates and atomically creates each approved classification without teams` invokes `createOwnMemberProfile` (`validation`, `data-access`) | Added; latest PR-head GitHub Actions result pending |
| Country, federation, region, FEI ID, official status and Technical Delegate canonical validation | Valid/invalid persisted mutations (`validation`) | Not yet verified |
| Every approved classification transition closes only prior active roles, creates required roles, preserves history, and avoids unchanged duplicates | `every approved classification transition preserves history and unchanged active role rows` invokes `updateMemberProfile` for the full transition table (`data-access`) | Added; latest PR-head GitHub Actions result pending |
| Profile edits create before/after history, audit and administrator notification | `successful profile edit commits profile, role history, evidence, and notification atomically` invokes `updateMemberProfile` | Added; latest PR-head GitHub Actions result pending |
| Profile edits preserve membership dates/entitlement, billing/payment, and Stripe identifiers | The success and transition graph comparisons inspect membership, billing customer linkage, and migration mapping; subscription/payment projections are not yet present in the Release 1 schema | Partially covered; not Verified |
| Invalid profile change mutates none of profile, roles, history, audit, notifications, membership or billing | `invalid professional payloads persist nothing` invokes `createOwnMemberProfile`; edit-specific invalid graph coverage remains open | Partially covered; not Verified |
| Failures at profile, role, history, audit, notification and account-state stages roll back everything | `controlled failures at every profile-edit stage roll back the complete persisted graph` invokes `updateMemberProfile`; onboarding account-state injection is available but its graph test remains open | Partially covered; not Verified |
| Professional-role history is preserved | Full transition-table and successful-transaction tests invoke `updateMemberProfile` and inspect all historical rows | Added; latest PR-head GitHub Actions result pending |
| Required state changes create audit evidence | State transition test (`membership`) | Not yet verified |
| Link requests, rate limits, delivery attempts/completion/terminal status and reconciliation failures retain evidence | End-to-end operational evidence test (`auth`, `delivery`) | Not yet verified |
| All evidence excludes passwords, tokens, payloads, keys, credentials, email/origin, secrets and raw exceptions | Persisted evidence scan after all failure paths (`auth`, `delivery`) | Not yet verified |

### Tokens, recovery, activation, and sessions

For **each** registration-verification, password-reset, and migrated-activation purpose, PostgreSQL tests remain required for: digest-only storage; absence of raw-token persistence; purpose and ownership enforcement; expiration and malformed-token rejection; atomic one-time consumption; replay rejection; two-connection single-winner consumption; cross-purpose and cross-user denial. These requirements exercise `email-verification`, `account-recovery`, token queries, and account-delivery persistence and are **Not yet verified**.

The following independent requirements are also **Not yet verified**:

- password reset increments session version and invalidates existing sessions;
- plaintext passwords never appear in storage or operational evidence;
- anonymous responses are neutral; nonexistent accounts create neither tokens nor delivery rows;
- lower-level helpers cannot bypass rate limiting;
- injected clocks/sleepers provide timing equalization without real delay;
- configuration, encryption, database, and operational failures create only non-sensitive server evidence.

### Migrated-member activation

PostgreSQL activation tests remain required for each imported classification (Judge, Steward, Judge + Steward, Veterinarian). Each must prove correct `wp_user` mapping; preservation of identity/profile/role history/entitlement/paid-through/billing/Stripe customer/Stripe subscription/migration map; and absence of duplicate users, profiles, memberships, billing accounts, roles, Stripe references, or mappings. Separate malformed, missing, conflicting, and incomplete-foundation cases must prove no fallback to onboarding, no mutations on failure, and non-sensitive reconciliation evidence. All are **Not yet verified** at the activation server-function boundary.

### Delivery worker and cron

The following PostgreSQL worker behaviors remain **Not yet verified**: one-time success evidence; exact single attempt increment; correct bounded backoff; maximum-attempt dead lettering and no reclaim; retained audit/delivery history; concurrent administrator notification delivery; stable message identity; bounded retry attempts; eligibility recheck after claim/before send; terminal rows counting toward batch size; preserving an earlier delivered usable token after a failed replacement; atomic token/outbox commit; delivered mail referencing a committed token; and database failure preventing external delivery.

Cron route unit tests remain supplemental. Behavioral coverage is still required for missing/invalid/valid header authentication, authentication before outbox access, rejection of query authentication, batch bound, empty queue, retry continuation, approved response shape, secret/PII-safe logs/evidence, and agreement between `vercel.json` and the protected route schedule. These are **Not yet verified** as a route-plus-PostgreSQL test.

### Build/runtime boundary and command gate

Build/runtime unit tests are supplemental. Provider-call interception during `pnpm build`, static prerender behavior, production missing-config rejection, build-placeholder runtime rejection, and absence of fake production credentials remain **Not yet verified** as the required build-boundary suite.

The following commands must all pass on this branch before any row may be promoted based on its test: `pnpm install --frozen-lockfile`, `pnpm check`, all targeted suites, `pnpm test:integration-db`, `pnpm build`, `pnpm check:release1`, and `git diff --check`. Database provisioning failure or zero applicable tests is a hard failure. The Release 1 GitHub Actions workflow supplies `pnpm check:release1` with a disposable PostgreSQL 16 service database named `idoc_test`; it does not use Render or `POSTGRES_URL`. A successful workflow run, latest-head Codex review, actionable-thread resolution, deployment, and UAT have not been claimed by this document.

## Closure decision

Release 1 is explicitly **open**. The next implementation work must replace each open row with a narrowly named real PostgreSQL test, run the complete local command gate, and record the actual result. Release 2 must not begin before every Release 1 acceptance condition, latest-head review, and actionable review thread is complete.
