Warning: truncated output (original token count: 28221)
Total output lines: 791

**IDOC**

**Administrator & Operations Runbook**

## Dashboard navigation and Organization Settings

- Administrators and Super Admins enter through **Admin Dashboard** in the authenticated initials menu. Members do not receive that server-derived menu capability and `/admin` remains default-deny.
- Shared operational destinations appear before the separate Super Admin group in the responsive left navigation. A missing link is not an authorization control: every page and mutation rechecks current server-managed grants.
- Organization Settings, support-category defaults, and security operations are Super-Admin-only. Direct access by an Administrator is translated to the standard branded not-found response.
- If an authorized admin page fails, its error screen shows the path (without query values), UTC time, server error digest when supplied by Next.js, and a log reference returned by `/api/client-error`. Expand **Technical details** to see the browser-provided error type, message, and stack, and copy the diagnostic block. Match the log reference in Vercel runtime logs and use the path and time to find the original server request. Next.js masks server error messages in production; the browser cannot reveal their underlying stack. Review copied details for personal information before sharing them. The reporting endpoint never accepts or logs these details.
- Organization address edits update the singleton structured address consumed by both the footer and Contact page. Blank optional values remain absent from public formatting; save revalidation refreshes both consumers.
- Online via Stripe is a protected canonical seminar-payment method and cannot be disabled, edited, or deleted. Bank Transfer and Cash are the supported alternate methods. Bank Transfer cannot be enabled without visible instructions; submitted rich text is sanitized on the server and sanitized again before rendering. Disabling Bank Transfer preserves its prior instructions unless replacement content is supplied.

## Filtered membership and revenue reporting

`/admin/members` is the canonical administrator roster. It defaults explicitly to active
entitlements and performs name/email search, status, inclusive expiration date, canonical address
country, federation, IDOC region, and professional-classification filtering in PostgreSQL. Filters
are combinable, URL-addressable, sorted deterministically, and returned in pages of 25. The
filtered CSV endpoint reruns that same authorized query, exports at most 25,000 rows, records only
the actor, filters, and result count in the audit log, emits a UTF-8 BOM, and prefixes formula-like
cells with an apostrophe. Administrators must narrow an over-limit export.

`/admin/revenue` aggregates the persisted membership payment ledger, never live Stripe data. Its
default range is the first UTC day of the month eleven months ago through today. Complimentary
entries are not revenue; results remain grouped by currency.

The selected-member panel provides Payment History, Record Manual Payment, Extend Expiration Date,
Edit Member Information, Change Membership Type, Email Member, and protected member-centric Seminar
History. Payment History is a newest-first, member-scoped safe projection of the persisted ledger.
Seminar History is re-authorized for an administrator and scoped to the server-resolved member before
reading registration records. Email Member is only a `mailto:` link to the current canonical account
address.

Roster rows now expose stable profile-ID selection and document a maximum batch size of 50. No
bulk mutation is enabled yet. The only authority-wide operation is the Super Admin incident action
**Force Revoke All Authority**; it is not an ordinary canonical Revoke User operation and must not
be reinterpreted as Bulk Revoke. Product owners must define ordinary revoke eligibility, effects,
privileged/self protections, notices, and retry semantics before Bulk Revoke can be enabled. A
future enabled bulk operation must re-fetch every ID, re-authorize and re-evaluate eligibility,
confirm access removal, prevent duplicate submission, preserve filters, and report per-member
success/failure/skipped outcomes.

Archive Membership remains unavailable until durable Stripe/Mailchimp external-operation handling
and seminar-registration identity snapshots exist. Pause Membership remains unavailable until
entitlement, expiration, collection, resumption, manual/one-time behavior, and notice rules are
approved. Neither control substitutes another account or membership transition.

Payment rows do not snapshot professional classification. Revenue reporting therefore cannot
reliably filter or group historical receipts by membership type and must not join to a member's
current roles as if those roles applied at payment time. A later deliberate migration may snapshot
classification for new payments, but historical rows must not be backfilled from current state.

The roster keeps never-paid, active, grace, expired, suspended, revoked-account, archived, and
deleted states distinct. `canceled` remains an internal renewal state and is active only while paid
through. **Pause remains unavailable:** no approved rules define entitlement, expiration, Stripe
collection, resumption, manual/one-time handling, or notices. Archive automation also remains
blocked until a durable external-operation contract covers Stripe and Mailchimp and the Release 5
seminar schema can preserve future-registration identity snapshots. Existing audited suspension
and revocation must not be represented as pause or archive.

Day-to-day procedures after the IDOC membership platform goes live

| **Organization**     | International Dressage Officials Club (IDOC)   |
|----------------------|------------------------------------------------|
| **Current site**     | idoc.club                                      |
| **Target platform**  | Next.js on Vercel + Render PostgreSQL + Stripe |
| **Document version** | 1.3                                            |
| **Date**             | 4 September 2026                              |

Working project document. Update this document when project decisions change.

## Codex pull-request review request

Codex automated review is advisory. When a pull request is opened or updated, the workflow requests a Codex review and exits promptly without polling. The legacy `codex/review-complete` status remains temporarily for branch-rule compatibility and means only that the review was requested; it does not certify review completion. Any Codex comments or inline findings remain visible for the author to address, while fast and risk-classified full CI workflows determine test readiness.

After the updated workflow is deployed, remove `codex/review-complete` from the required status checks in both `staging-protection` and `main-protection`. Keep `Fast PR checks` required. Full release and authentication/security workflows remain required by the merge procedure whenever `docs/26-ci-risk-classification-and-agent-merge-policy.md` classifies the change as requiring them. Staging acceptance and the live or manual checks required by this runbook remain mandatory before a staging-to-main promotion.

## Branch, environment, and deployment workflow

Two long-lived branches drive the two live Vercel deployments referenced throughout this document. There is no other route to either domain: a change reaches `staging.idoc.club` or `redesign.idoc.club` only by landing on the branch that feeds it.

| Branch | Vercel environment | Domain | Purpose |
|---|---|---|---|
| `staging` | Preview (a dedicated, always-on Preview deployment, not an ephemeral per-PR one) | `staging.idoc.club` | Where every change is verified before it ships: UAT, migration rehearsal, and the Claude Code Cloud live-auth audit (`docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md`). Enforced by the GitHub ruleset `staging-protection` (§ below). |
| `main` | Production | `redesign.idoc.club` today; becomes `idoc.club`/`www.idoc.club` at the go-live domain cutover (§ "Stripe payment production readiness" below) | The real deployment. Enforced by the GitHub ruleset `main-protection` (§ below). Receives only reviewed promotions from `staging`, never a feature branch directly. |

**Enforcement is a GitHub ruleset on each branch, not just this document.** Both `main-protection` and `staging-protection` (`Settings → Rules → Rulesets`) require the `Fast PR checks` and `codex/review-complete` status checks to pass before any ref update — merge or direct push alike, since a fresh commit has no recorded check runs until it has gone through a PR. `codex/review-complete` is a legacy compatibility status: after the CI-efficiency update it confirms only that an advisory Codex review was requested, not that the review finished. Remove it from both rulesets once the updated workflow is deployed; keep `Fast PR checks` required and continue to require the applicable full workflow under the risk-classification policy. Neither ruleset has any bypass actor configured, deliberately: any GitHub identity acting under the repository owner's account — including Claude Code Cloud, which performs its GitHub actions as the owner via the installed GitHub App — would otherwise inherit an owner-scoped bypass, defeating the point of the gate. Before 25 September 2026, `main` had no GitHub-enforced protection at all; `codex/review-complete` being "required" was a convention Claude and Codex followed voluntarily, not something GitHub actually blocked on. Both branches are now genuinely enforced.

**Staging is deliberately near-identical to production, not a separate sandbox.** `staging.idoc.club` and `redesign.idoc.club` read/write the *same* Render PostgreSQL instance and share most of the rest of the environment-variable inventory verbatim (`AUTH_SECRET`, the MFA encryption/signing keys, `CRON_SECRET`, `RATE_LIMIT_HASH_KEY`, `IDOC_ADMIN_NOTIFICATION_EMAIL`, and more — see §15.1 below for the full inventory and exactly which rows differ). This is deliberate: it is what makes verification on staging predictive of how a change will actually behave once promoted, and it avoids paying for a second Render Postgres instance. What structurally has to differ stays distinct even under this policy:

- Each environment's own `BASE_URL`/`GOOGLE_OAUTH_REDIRECT_URI`.
- The Turnstile keys (staging uses Cloudflare's always-pass testing pair, scoped to the `staging` branch, since an automated Claude Code test run cannot solve a real interactive challenge).
- `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (§ "Stripe payment production readiness" below): both environments currently use a test key together only because `redesign.idoc.club` isn't the canonical domain yet. At the go-live domain cutover, Production must switch to a live key while `staging.idoc.club` (a Preview deployment) must keep using a test key — sharing this value verbatim would fail closed on one side or the other the moment that cutover happens (`lib/runtime/stripe-configuration.mjs`'s `stripeDeploymentMode`), so Stripe credentials are never part of the "shared" set even though they happen to match today.
- `BREVO_API_KEY`/`BREVO_WEBHOOK_KEY` (§15.1 below): kept distinct so staging's automated test traffic never sends through, or trips webhook signature checks against, the real production Brevo account.

Because of this near-total sharing:

- Any account, membership, or test data created against `staging.idoc.club` is real production data. Clean it up (see `docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md`'s cleanup rules); don't treat it as disposable.
- **A migration must be backward-compatible with whatever code is still live on `main`, not merely "safe to run once."** Verifying a staging-only change applies its migration to the *same* database `main`'s still-live, not-yet-promoted code is currently reading and writing — the shared database means a migration bypasses the promotion gate entirely, taking effect on `redesign.idoc.club` immediately regardless of whether its own code has been promoted yet. A destructive change in the same migration (a dropped column/table, a newly-required constraint) can break production mid-verification, before the corresponding code ever ships. Use an additive expand/contract pattern instead: add new columns/tables nullable or defaulted, backfill, and only drop the old shape in a later migration after the code that stops needing it has been promoted. This repository has shipped destructive migrations before (`0035_remove_webauthn_passkeys.sql`, `0037_remove_redundant_user_name.sql`); treat that pattern as unsafe to repeat for a staging-verified-but-not-yet-promoted change under this policy. `main` and `staging` share one `idoc.__drizzle_migrations` ledger.
- Stripe test-mode acceptance runs (§ "Stripe payment production readiness" below, `docs/25` §8) execute against this same shared database — test payments and entitlements land in real production data and need the same cleanup discipline as any other staging test data, not a separately isolated schema.
- **Known unresolved risk, not yet mitigated: none of the queues `/api/cron/account-delivery` drains have an environment partition.** That one route (`app/api/cron/account-delivery/route.ts`) processes four separate shared tables in sequence, and every one of them has the same gap: `claimAccountDelivery()` (`lib/notifications/account-delivery.ts`, `idoc.account_delivery_outbox`), `processAuthSecurityNotificationBatch()` (`lib/notifications/auth-security-delivery.ts`, `idoc.auth_security_notification_outbox`), `processOperationalAlertBatch()` (`lib/notifications/operational-alert-delivery.ts`, `idoc.operational_alert_outbox`), and `processStripeCustomerEmailSyncBatch()` (`lib/payments/customer-email.ts`, `idoc.notification_outbox`) each lease the oldest eligible row with no predicate distinguishing which deployment queued it. Distinct `BREVO_API_KEY`/`BREVO_WEBHOOK_KEY` values (above) do not fix this for any of them: if this Cron endpoint is ever invoked against `staging.idoc.club` (e.g. for a staging Cron UAT check per §12.1 below) while a real production row is queued in *any* of the four, staging can claim and send it — a password reset, a security/operations alert, or a Stripe customer-sync job — through staging's infrastructure (and, once Stripe credentials diverge at the go-live cutover, against test-mode Stripe instead of the real one). The reverse (production claiming a staging test row) is less harmful but still wrong. All four queues need partitioning by deployment (an origin/environment column plus a claim predicate, or fully separate queues) before it's safe to invoke this Cron endpoint against real data; until that lands, treat any staging Cron UAT of this endpoint as unsafe to run for real and get explicit operator sign-off first.

**Dormant configuration gap, not currently exploitable:** in the live Vercel project configuration, only `BASE_URL`/`GOOGLE_OAUTH_REDIRECT_URI` and the Turnstile keys actually carry a `gitBranch: "staging"` override restricting them to the `staging` branch. Every other genuinely shared value above (`POSTGRES_URL`, `AUTH_SECRET`, the MFA keys, `CRON_SECRET`, etc.) is set with `target: ["production", "preview"]` and no branch restriction — so *if* Vercel ever built an ordinary per-PR preview deployment for some other branch, that preview would also receive these production values. As of this writing, Vercel is not configured to build preview deployments for any branch other than `staging`, so this is not a live exposure today — there is no other branch with a running deployment for the gap to actually reach. It's worth closing (a `gitBranch: "staging"` override carrying the identical value, removing the unrestricted grant, with zero effect on staging's parity with production) as insurance against per-PR previews ever being turned on later, but it is not urgent.

### The rule: `staging` is the gate, `main` only receives promotions

`main` must never gain a commit that `staging` hasn't already carried — otherwise "has this actually been verified?" has no reliable answer. Concretely:

1. **All ordinary feature/fix work branches off `staging`, and its PR targets `staging`.** Nothing goes to `redesign.idoc.club` without first being reachable at `staging.idoc.club`.
2. **Verify the change on `staging.idoc.club`** — UAT, a migration rehearsal, or a Claude Code live-auth run, as the change warrants — before it goes any further.
3. **Promote by opening a `staging` → `main` pull request once the change is verified.** This promotion PR reruns the fast gate; Codex feedback is advisory. Promotion is a deliberate step only after the staging revision has passed every applicable full workflow and the required staging UAT, migration rehearsal, and live-user checks. Merging it is what actually ships the change to `redesign.idoc.club`.
4. **`main` is never a direct target for feature work.** The only exception is a genuine production emergency that cannot wait for a staging cycle — and even then, merge the same fix into `staging` immediately afterward so `staging` doesn't fall behind what's already live. **Executing this exception when the ruleset itself is the obstacle** (e.g. a required CI workflow is broken during an active incident) means the repository owner temporarily sets the relevant ruleset's enforcement status to `Disabled` in `Settings → Rules → Rulesets`, completes the emergency push or merge, and immediately re-enables it. This is the sanctioned bypass mechanism — a deliberate, visible, one-off admin action instead of a standing bypass-list entry, because a standing entry tied to the owner's account would also cover every action Claude Code Cloud takes on the owner's behalf (see above), not just ones the owner actually decided in the moment.
5. **`git log origin/main..origin/staging` showing commits is normal**, not drift — it's the backlog of changes verified on staging and awaiting deliberate promotion, and it grows again the moment any new ordinary work lands on `staging`, including right after a clean promotion. Checking the reverse direction for an actual bypass needs `git log --no-merges origin/staging..origin/main` specifically — plain content-diffing (`git diff origin/staging origin/main`) or a raw `--is-ancestor` check on the two branch tips both give false positives here: a legitimate `staging` → `main` promotion's own merge commit exists only on `main` (never reachable from `staging`, since `staging` isn't touched by that merge), which makes both of those alternatives flag every single clean promotion as a bypass. `--no-merges` avoids this by filtering merge commits out and comparing only ordinary content commits; since `staging` only ever grows forward, the set of "`main` commits `staging` doesn't have" can only shrink or stay the same as `staging` gains more backlog afterward, never re-appear — verified directly against this repo's history immediately after a real promotion (PR #273) and again after further staging activity, both clean as expected. A non-merge commit actually showing up there means `main` has a commit `staging` never saw; treat that as the real anomaly to investigate and, if it wasn't an authorized emergency hotfix, back-merge it into `staging` right away. (This assumes promotions use a real merge commit, not a squash — the convention already in use in this repo.)

Before this policy existed, work had been merged directly into both branches independently: as of 24 September 2026, 16 commits had reached `main` without ever passing through `staging` (process debt from before this policy, not something to redo), and 8 commits were verified on `staging` but never promoted (normal backlog, just overdue). The one-time reconciliation is: (a) merge those 16 main-only commits into `staging` so `staging` reflects everything already live, then (b) open the overdue `staging` → `main` promotion PR for the 8 staging-only commits so they actually ship. Once both land, the branches are aligned and the policy above governs from there.

### Claude's and the operator's responsibility specifically

- Branch feature/fix work off `staging` and target `staging` with the PR — not `main` — unless the task is an explicitly declared production emergency.
- Never promote `staging` into `main` without the change actually having been verified on `staging.idoc.club` first. Promotion is deliberate; don't fast-forward or auto-sync it.
- When asked to investigate "redesign doesn't show X" or "staging and redesign disagree," first check whether the change was ever promoted (`git log origin/main..origin/staging`) before looking for an application bug.
- If a genuine hotfix must go straight to `main`, back-merge it into `staging` in the same task so `staging` doesn't drift out of sync with what's already live.

# 1. Purpose

## Organization Settings operations

Super Admins manage the canonical address and seminar payment methods at `/admin/organization`. Online via Stripe is a required protected default and cannot be disabled or repurposed. Bank Transfer may be enabled only with sanitized member-facing instructions; disabling it preserves those instructions. Cash at the Event may be enabled or disabled. Prefer deactivation: do not delete methods, especially once seminar records reference them. Deploy migration `0038` through the isolated `idoc.__drizzle_migrations` ledger before this interface is used, and verify the three canonical rows occur exactly once. These are the only payment methods a seminar may use (§ Seminar operations below); a seminar cannot be created or edited onto a method that is not currently enabled here.

The same page also manages the membership perk list: a plain ordered list of labels, editable only by Super Admins, shown on every membership-tier box on the public `/membership` page and on the dashboard's `/dashboard/membership` payment box. Saving submits the complete list every time; the server replaces the whole table in one transaction rather than diffing individual rows, so there is no separate per-perk edit or reorder action. At least one perk is required — an empty submission is rejected rather than clearing the list. Deploy migration `0046` before this section is used; it seeds the four perks the site previously hardcoded.

Administrators and Super Admins operate the Support Inbox at `/admin/support`; the navigation count is the number of conversations with unread member messages. Conversations may be assigned to multiple administrators; opening a thread advances only the current administrator's read cursor and never clears another assignee's unread state. Replies, assignment/reassignment, close, and reopen are server-authorized and serialized against the conversation. Reopening derives `Admin Responded` or `Member Replied` from the latest immutable message. Super Admins configure one or more category-default administrators at `/admin/support/defaults`; a changed default affects new conversations only, and an empty assignment is rejected. Deploy migrations `0039`, `0042`, and `0043` before use. Never copy message bodies into the general audit log or request authentication secrets in support.
Administrators and Super Admins operate the Support Inbox at `/admin/support`; the navigation count is the number of conversations with unread member messages. Its Dice UI Data Table toolbar performs search next to simple per-column filters (category, status, and assignment as single-select facets, plus an activity date range), a custom multi-column sort list, drag-to-reorder column visibility, and pagination on the server. Table preferences are stored per administrator in the database and apply across sessions and devices when the URL does not supply an explicit view. Row selection currently provides only a safe clear-selection action; conversation mutations remain inside the authorized thread workflow. Conversations may be assigned to multiple administrators; opening a thread advances only the current administrator's read cursor and never clears another assignee's unread state. Replies, assignment/reassignment, close, and reopen are server-authorized and serialized against the conversation. Reopening derives `Admin Responded` or `Member Replied` from the latest immutable message. Super Admins configure one or more category-default administrators at `/admin/support/defaults`; a changed default affects new conversations only, and an empty assignment is rejected. Deploy migrations `0039`, `0042`, and `0043` before use. Never copy message bodies into the general audit log or request authentication secrets in support.
Administrators and Super Admins operate the Support Inbox at `/admin/support`; the navigation count is the number of conversations with unread member messages. When an administrator opens the inbox without URL table parameters, the server materializes the saved per-administrator filters, join operator, sorting, page size, and visible columns into the URL before the client table hydrates; an explicit URL view always takes precedence, including an explicit empty column selection. Its Dice UI Data Table toolbar performs search next to simple per-column filters (category, status, and assignment as single-select facets, plus an activity date range), a custom multi-column sort list, drag-to-reorder column visibility, and pagination on the server. Table preferences are stored per administrator in the database and apply across sessions and devices when the URL does not supply an explicit view. Row selection currently provides only a safe clear-selection action; conversation mutations remain inside the authorized thread workflow. Conversations may be assigned to multiple administrators; opening a thread advances only the current administrator's read cursor and never clears another assignee's unread state. Replies, assignment/reassignment, close, and reopen are server-authorized and serialized against the conversation. Reopening derives `Admin Responded` or `Member Replied` from the latest immutable message. Super Admins configure one or more category-default administrators at `/admin/support/defaults`; a changed default affects new conversations only, and an empty assignment is rejected. Deploy migrations `0039`, `0042`, and `0043` before use. Never copy message bodies into the general audit log or request authentication secrets in support.

## News/Blog operations

Administrators and Super Admins manage public News/Blog articles at `/admin/news`: create, edit, preview, publish, unpublish, schedule, archive, and delete. Deploy migration `0040` before use.

- **Fields:** publication date (UTC), title, subtitle (optional), rich-text content, publication status, and slug (auto-generated from the title if left blank, editable afterward, and rejected on collision).
- **States:** Draft (never public), Scheduled (never public until its publication date passes), Published (public), Archived (never public, retained for history).
- **Publishing:** "Publish now" makes an article public immediately; editing the status field to Scheduled with a future publication date defers it. A Vercel Cron job (`/api/cron/news-scheduled-publish`, every 5 minutes, UTC, gated by `CRON_SECRET`) transitions overdue scheduled articles to Published automatically. Public pages independently re-check `publication_date<=now()` on every read, so an article can never appear early even if a transition is delayed.
- **Deletion:** only Draft or Archived articles can be permanently deleted. Archive a Published or Scheduled article first — this preserves a retained record before an irreversible delete, matching the same "deactivate before delete" preference used elsewhere in this runbook (Organization Settings payment methods, §1).
- **Preview:** the edit page's Preview link renders the article exactly as the public page would, for any status, without making it publicly reachable.
- Every create, edit, publish, unpublish, schedule, archive, and delete action is audited under `news_article` entity type; the scheduled-publish Cron transition is audited with a null actor (a system action).
- Legacy IDOC News and President's Blog content from the old `idoc.club` WordPress site is a one-time import via `scripts/data-import/legacy-idoc-club-content-import.sql`; see docs/03 § 10 for the source mapping, assumptions, and reconciliation.

## Seminar operations

Administrators and Super Admins manage seminars at `/admin/seminars`: create, edit, publish, cancel, move back to draft, search/filter, review registrations, mark a manual payment received, and export registrations to CSV. Members register and cancel their own registrations at `/seminars`. Deploy migration `0041` before use.

Legacy seminar announcements from the old `idoc.club` WordPress site are a one-time import via `scripts/data-import/legacy-idoc-club-content-import.sql`; see docs/03 § 10 for the source mapping and required administrator review (two imported seminars are left in Draft pending a currency correction).

- **Fields:** title, description, date, start/end time, an IANA timezone (validated against the runtime's own timezone database), location or online meeting link, capacity, price (EUR), registration deadline (UTC), publication/registration status, and payment method (one of the three canonical Organization Settings methods above).
- **Publication status:** Draft (never public), Published (open for registration subject to capacity/deadline), Canceled (never public; registrations already made are retained, not deleted).
- **Member-facing availability** is derived, never stored: Open, Full (active registrations reached capacity), Registration closed (past the deadline), or Past (the seminar has ended) for a Published seminar; Draft and Canceled seminars show their own state. The registration deadline, seminar date, start/end time, and timezone together determine these transitions server-side; the public/member views re-derive them on every read rather than trusting a cached value.
- **Registration status and payment status are independent facts.** Registration status is Registered or Canceled. Payment status is Unpaid, Bank transfer pending, Cash pending, or Paid, and reflects the seminar's own configured payment method at the time of registration. Canceling a registration never overwrites its payment history (useful evidence if a refund is later decided outside this system).
- **Capacity and duplicate-registration enforcement** is transactional: registering locks the seminar row, re-counts active registrations, and checks for an existing row for that member before inserting or reactivating one, so two members racing for the last seat cannot both succeed and the same member cannot hold two active registrations for the same seminar. Canceling and re-registering reuses the same row.
- **Payment collection by method:**
  - *Online via Stripe*: registering redirects to an ad hoc Stripe Checkout Session priced from the seminar's own current fee (no persisted Stripe Product per seminar). The webhook handler verifies the completed session's amount and currency against the seminar's own price before marking the registration Paid — a tampered or mismatched session never grants credit. This never touches `idoc.payments` or `idoc.memberships`: seminar payments are classified separately and never alter membership entitlement.
  - *Bank Transfer*: registering sets the registration to Bank transfer pending and shows the same sanitized, organization-wide instructions Super Admins maintain in Organization Settings (§ above) — a seminar never stores its own copy. An administrator marks the registration Paid manually once the transfer is confirmed received.
  - *Cash at the Event*: registering sets the registration to Cash pending; an administrator marks it Paid manually at or after the event.
- **Immutability:** once a seminar has any registration, its price and payment method cannot be changed (editing rejects the attempt with a clear error); capacity can be increased freely but cannot be reduced below the current count of active (Registered) registrations. All other fields remain editable at any time.
- **CSV export** (`/api/admin/export/seminar-registrations?seminarId=…`) is scoped to one seminar, exposes only seminar title, member name, member email, registration status, payment status, and the three relevant timestamps (registered/canceled/paid), is capped at 25,000 rows, and is audited with the actor, seminar, and result count — the same conventions as the existing member/payment/audit-log exports (§ above).
- Every seminar create, edit, status change (publish/cancel/draft), and registration/payment mutation (member registration, member cancellation, administrator manual-payment confirmation, and the Stripe webhook's payment confirmation) is audited.

## Members Directory and Map operations

There is no administrator management interface for this feature — both surfaces read the existing member/profile/membership tables directly and there is nothing to author. No migration is required.

- **Public map** (`/about/members-directory`, unauthenticated): aggregates currently-entitled members by country. A country is shown only once it has at least `DIRECTORY_MIN_AGGREGATION_THRESHOLD` (`lib/directory/aggregate.ts`, currently 5) members — an operator who needs to raise or lower this threshold changes that one constant and its accompanying tests/docs reference, and should treat lowering it as a privacy-sensitive change requiring the same review rigor as any other change in [05 Security and Privacy Requirements](05-security-and-privacy-requirements.md#3-member-data-isolation-objectives). A database error while computing the map is caught and logged as the `directory_map_query_failed` security event (operational retention) rather than surfacing a raw error to the public; repeated occurrences warrant the same triage as any other operational alert (§ Security event logging below).
- **Paid member directory** (the member-only tab at `/about/members-directory?tab=directory`): every entitled member and every administrator/Super Admin can search it; there is no separate administrator view. Filters are membership type, federation, country, and IDOC region, plus a name search. Search is rate-limited per account and per origin using the existing rate-limit facility (`member_directory_search` purpose — see [05 Security and Privacy Requirements](05-security-and-privacy-requirements.md#rate-limiting-independent-ip-and-normalized-email-limits)) — a member who reports being blocked mid-session should simply wait a few minutes before retrying; this is not an account-level lockout and does not require administrator intervention.

This runbook defines normal administrative actions, exception handling and escalation boundaries. It is intended to prevent ad-hoc database edits and preserve a reliable audit trail.

# 2. Normal member lookup

1. Search by name, email, legacy ID or external billing identifier as permitted.

2. Confirm identity using more than one field before making sensitive changes.

3. Review membership status, valid-through date, professional roles and payment source.

4. Review recent audit entries before changing a disputed record.

# 3. Record a bank transfer, PayPal or cash payment

1. Open the existing member record.

2. Select Record payment.

3. Choose payment source.

4. Enter €80 in EUR. Do not enter partial, discounted, or waived payments.

5. Enter actual paid date and reference/transaction evidence.

6. Review the proposed membership validity change.

7. Submit with a reason; every administrator action is audited.

8. Confirm the new payment and audit entry appear.

# 4. Review a member classification or profile change

Members may change every signup/profile field themselves. Administrators receive a notification and can review the complete history of the change. Do not alter the member's paid-through date or billing relationship merely because classification information changed.

# 5. Change judge/steward level

1. Verify the official IDOC source/authorization for the level change.

2. Open Professional roles.

3. End-date the prior level record if history is retained.

4. Create/activate the new level with effective date.

5. Add a concise administrative reason/source.

6. Confirm the audit entry.

# 6. Convert professional category

Do not overwrite unrelated roles. For a member becoming Judge + Steward, retain the Judge role and add a Steward role with its own level. For a role that genuinely ends, close/end-date that role rather than erasing history.

Before approving a classification change, confirm that every field required by the target classification is present and valid under the approved field dictionary. A Steward becoming a Judge must supply a valid Judge status and Technical Delegate answer. A member becoming Judge + Steward must have both valid Judge and Steward statuses. Veterinarians require only the common member fields. Professional changes do not create a new membership or alter the €80 billing cycle.

# 7. Stripe billing issue

| **Situation**                | **Action**                                                                                                           |
|------------------------------|----------------------------------------------------------------------------------------------------------------------|
| Payment failed               | Check local event record and Stripe status; Stripe retries automatically; member remains active for five days, then expires if unpaid. Do not manually mark paid without evidence. |
| Member updated card          | Normally no local action; Stripe Customer Portal/next invoice handles it.                                            |
| Member canceled auto-renew   | Confirm cancel-at-period-end; membership remains active through paid-through date.                                   |
| Member enables auto-renew    | Confirm payment authorization and future activation exist; verify no immediate charge and no start before the current paid-through date. |
| Member reverses pending choice | Confirm the pending transition was canceled/replaced and that only one future billing path remains.                 |
| Subscription missing locally | Do not create a second subscription. Reconcile by verified Stripe Customer/Subscription ID.                          |
| Duplicate charge concern     | Inspect Stripe invoices/payments and local idempotency/audit records before changing membership.                     |
| Reconciliation flags an anomaly | Review the finding on the Stripe reconciliation report (§13.1). Confirm against Stripe directly before acting; correct through the normal suspend/reinstate/entitlement-correction tools — never edit `reconciliation_findings` directly, and never let the report's own presence stand in for verified evidence. |

# 8. Manual correction policy

- Never edit production database rows directly for routine membership corrections.

- Use the admin interface so validation, reason capture and audit logging are applied.

- If an emergency database correction is unavoidable, document the incident, exact rows changed, actor, reason and before/after values.

- Do not delete payment history to make a screen look correct; correct the relationship/status and preserve evidence.

# 9. Member says they cannot log in

1. Confirm the member exists and the email address on record is correct.

2. Check account activation/verification status without changing membership entitlement.

3. Use the supported password-reset/magic-link workflow.

4. Do not manually set or ask for the member's password.

For an Administrator or Super Admin password-reset request, the recovery screen requires the
account's active authenticator factor and never sends or falls back to an email OTP. If…8221 tokens truncated…-browser fallback. The same Google Client Secret is valid across all of that client's registered redirect URIs, so production and staging may share the same ring; only `GOOGLE_OAUTH_REDIRECT_URI` itself must differ per environment. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Required absolute HTTPS callback URI outside local development. It must be exactly `${BASE_URL}/api/auth/google/callback` for the deployed canonical origin and exactly match a Google authorized redirect URI. | Not secret; exact-match across instances and provider console. Each stable protected staging origin needs its own explicit callback. Do not use arbitrary per-PR hosts with the production client. |
| `BREVO_API_KEY` | Required server-only Brevo-issued transactional API key (provider-defined length). Delivers login OTP and durable security/account messages. | Rotate in Brevo and Vercel; queued messages remain in PostgreSQL and retry with the new credential. It does not invalidate auth material. Use a non-production account/key or tightly controlled test subaccount in staging. |
| `BREVO_FROM_EMAIL` | Required syntactically valid sender address for every transactional email (`accounts@idoc.club` in production). | Must be a verified sending identity in Brevo. Changing it does not invalidate auth material; confirm the new address is verified before deploying. |
| `BREVO_WEBHOOK_KEY` | Required server-only random text of at least 32 characters. Brevo does not sign webhook deliveries, so this value is instead required as a `key` query parameter on the Notify URL configured in Brevo's dashboard for bounce/complaint events. | Rotate by updating both the Notify URL in Brevo's dashboard and this value together; a mismatch causes webhook deliveries to be rejected (400) until both sides agree. Distinct per environment. |
| `CRON_SECRET` | Required server-only random text of at least 32 characters. Vercel Cron presents it as `Authorization: Bearer …` to `/api/cron/account-delivery`; the worker handles retry/dead-letter delivery. | Must match all instances and scheduler. Rotation can temporarily cause 401s and delay mail but does not invalidate auth state; update scheduler/deployment compatibly. Shared with production. |
| `ACCOUNT_DELIVERY_KEY_VERSION` / `ACCOUNT_DELIVERY_ENCRYPTION_KEYS` | Required active 1–30 character version plus server-only JSON version ring. Ring values are the existing encrypted-outbox key format (at least 32 characters). Protects raw, short-lived account-link payloads until delivery. | Add the new value/version before switching active; retain old versions until no pending row references them. Removal makes affected pending deliveries fail safely. Shared with production, not a distinct staging ring. |
| `RATE_LIMIT_HASH_KEY` | Required server-only random text of at least 32 characters. Keys privacy-preserving authentication-adjacent rate-limit identifiers. | Must match across instances. Rotation loses continuity of existing rate-limit buckets and should occur only during a controlled window; it does not revoke sessions/factors. Shared with production. |
| `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Required Cloudflare server verification secret (at least 32 characters under runtime validation) and intentionally public site key. Protect anonymous auth boundaries. | Configure as a matched Cloudflare widget pair for each allowed hostname. Secret is server-only; site key may reach browsers. Rotation does not revoke auth material. Do not reuse production's real secret in staging. **Exception:** `staging.idoc.club` (which shares the real `idoc.club`-domain widget's hostname allowlist) deliberately uses Cloudflare's own public "always passes" testing key pair instead of a second real widget, so the Claude Code live-auth audit can complete Turnstile-gated flows unattended; `verifyTurnstile` (docs/21 AUTH-TURNSTILE-006) accepts that pair's fixed response shape only when the deployment's own hostname is exactly `staging.idoc.club` (a positive allow-list, not merely "outside Production") and `VERCEL_ENV !== 'production'`. |
| `IDOC_ADMIN_NOTIFICATION_EMAIL` | Required syntactically valid operations recipient for privileged production configuration alerts/workflows. Also the recipient for breached-password rejection alerts (docs/21 AUTH-PASSWORD-007) and the `Contact:` address published at `/.well-known/security.txt` (docs/21 AUTH-SUPPLY-002) — one operations mailbox, not a separate secret per purpose. | Not cryptographic; keep consistent across instances. Shared with production, not a separate staging recipient. |

`STRIPE_*` and product variables are production runtime requirements but are intentionally outside this authentication inventory and are unchanged by this readiness work.

## 15.2 Generating and rotating keys

Generate each self-managed 32-byte base64url secret independently in an approved operator terminal, then transfer it directly to the deployment secret store without printing it into retained logs:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Use that output for each base64url digest/signing key. For the TOTP ring, assign a non-secret ID and construct valid JSON only inside the Vercel secret editor. `AUTH_SECRET`, `CRON_SECRET`, and `RATE_LIMIT_HASH_KEY` may use independently generated high-entropy values; never reuse one secret for two purposes.

Safe TOTP encryption rotation is strictly additive:

1. Generate a new 32-byte key and choose a new key ID.
2. Add it to `MFA_TOTP_ENCRYPTION_KEYS` while retaining every old ID.
3. Set `MFA_TOTP_ACTIVE_KEY_ID` to the new ID and deploy all instances.
4. Confirm new enrollment/replacement stores the new ID and an old factor still verifies.
5. Retire an old ID only after a database inventory confirms no factor references it. There is no automatic re-encryption.

`AUTH_SECRET` session-cookie rotation has two distinct procedures depending on why you are rotating:

**Routine rotation (no suspected compromise) -- graceful overlap, no forced sign-in:**

1. Copy the current `AUTH_SECRET` value into `AUTH_SECRET_RETIRED_KEYS` (a JSON array; append to any existing entries rather than replacing them).
2. Set `AUTH_SECRET` to a newly generated value and deploy all instances together (both variables must land in the same deploy).
3. Outstanding session cookies signed under the retired value keep verifying and naturally re-sign under the new active value the next time `middleware.ts` refreshes their idle activity -- no forced sign-in occurs. The 15-minute transient authorities (pending signup/login/password-reset, Google-link fresh evidence, OAuth browser binding) are a hard cutover regardless: an in-flight one of those flows must be restarted, a negligible cost given their short lifetime.
4. After 12 hours plus one idle-refresh interval (comfortably 13 hours; the session absolute cap is `SESSION_ABSOLUTE_SECONDS`), every session has either refreshed onto the new key or expired on its own. Remove the retired value from `AUTH_SECRET_RETIRED_KEYS` and redeploy -- there is no automatic expiry of ring entries.

**Suspected compromise, or the mandatory post-restore reconciliation in §12.2 -- immediate hard cutover, forced sign-in intended:**

1. **Clear `AUTH_SECRET_RETIRED_KEYS` entirely -- unset it or set it to `[]` -- even if you believe it is already empty.** If a routine rotation's overlap window (the procedure above) was still in progress, its retired entry is still valid for verification; leaving it in place would let session cookies signed under that older key keep verifying right through this "immediate" cutover, silently defeating it. Set `AUTH_SECRET` to a newly generated value in the same deploy. Do **not** carry the old value into `AUTH_SECRET_RETIRED_KEYS`.
2. Deploy. Every existing session cookie -- and every transient authority -- fails verification immediately, exactly as rotation behaved before `AUTH_SECRET_RETIRED_KEYS` existed. This is the desired outcome when the prior secret may be compromised, or when closing the restore-resurrected-session risk in §12.2.

## 15.3 Google OAuth readiness

Configure the production Google client with application origin `https://idoc.club` and authorized redirect URI `https://idoc.club/api/auth/google/callback` (or the exact final canonical production origin if it differs). Add the stable protected staging origin's exact callback as an additional Authorized redirect URI on that same Google OAuth client, rather than registering a separate staging client: a Google OAuth client secret is valid across all of that client's registered redirect URIs, so `GOOGLE_OAUTH_CLIENT_ID` and the `GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS`/`_ACTIVE_VERSION` ring are shared between Production and Preview/staging (see §15), with only `GOOGLE_OAUTH_REDIRECT_URI` scoped per environment. The implementation retains persisted, single-use transaction state, PKCE S256, nonce, signed browser binding, exact origin/application/redirect binding, and server-side token/JWKS validation. Callback evidence is consumed atomically. Email equality alone never links an existing account. Explicit linking requires an authenticated session and current password, plus fresh TOTP step-up for privileged users. Privileged Google primary login always continues to TOTP; ordinary Google login follows the existing Google policy and never creates ordinary password-login device trust.

## 15.4 Email and worker signoff

Before auth UAT, invoke the deployed account-delivery Cron with its normal Vercel schedule and verify a successful non-sensitive count response, then use dedicated staging accounts to receive a `login_verification` OTP and at least one durable security event. Confirm delivery in Brevo Transactional activity and confirm the PostgreSQL outbox reaches `delivered`. Exercise a controlled provider failure to confirm retry and eventual delivery; exercise only a disposable staged record when checking dead-letter operations. Never send real email in automated tests, never record message secrets, and confirm notification bodies contain no password, OTP, TOTP seed, recovery code, cookie, token, or environment value.

## 15.5 Operator UAT checklist

Record account IDs/timestamps and safe audit/outbox identifiers, never credentials or codes.

### Ordinary member — password login and reset

- [ ] On an unremembered browser, correct password sends `login_verification`; wrong OTP fails and correct OTP succeeds.
- [ ] Without “Remember me”, a fresh login requires OTP again; with “Remember me for 2 weeks”, the same browser bypasses OTP only after password.
- [ ] “Forget this device” and “Forget all remembered devices” remove bypass; expired/revoked trust cannot bypass OTP.
- [ ] Reset request delivers verification; wrong/expired code fails and success changes the password.
- [ ] Reset makes existing sessions and session-version-bound remembered trust unusable, requires fresh sign-in, and delivers a security notification.

### Privileged enrollment, routine login, and reset

- [ ] Password or Google primary auth without a factor requires enrollment; QR/manual seed appears only during enrollment, invalid TOTP fails, and valid TOTP activates.
- [ ] Recovery codes appear once and acknowledgement is required before a normal session; enrollment notification arrives.
- [ ] Every password and Google login requires TOTP; ordinary remembered-device evidence cannot bypass it; wrong and replayed accepted counter fail where testable.
- [ ] No normal session exists before MFA succeeds.
- [ ] Privileged password reset requires TOTP with no email-OTP or remembered-device fallback; success revokes sessions, requires fresh login, and notifies.

### Authenticator recovery/replacement

- [ ] Start replacement on Security; one recovery code grants replacement authority only and creates no normal session.
- [ ] A used code cannot be reused; new enrollment succeeds; old authenticator and old recovery set stop working.
- [ ] Existing sessions are revoked, new codes appear once, acknowledgement is required, canonical completion requires a fresh normal session, and notifications arrive.

### Fresh step-up

- [ ] Verify privileged TOTP step-up for password change, an actual email change, Google link/unlink, role grant/revoke, and every other configured sensitive action.
- [ ] Without fresh authority the action challenges; ordinary remembered evidence cannot satisfy it.
- [ ] Authority is action-, session-, user-, version-, and role-bound, is single-use, and does not recreate the normal session.

### Sessions, roles, email, Google, and deletion

- [ ] With two sessions, Security identifies current; revoking one other stops it; “log out other sessions” preserves current; another user's session cannot be revoked.
- [ ] Promote an ordinary member who has trust: old session is invalid, trust cannot bypass privileged MFA, next login enrolls/challenges, and role notification arrives.
- [ ] Demote an Administrator: privileged sessions invalidate, stale trust does not resurrect, and next ordinary login follows ordinary policy.
- [ ] Email change requires new-address verification; login address changes only afterward; new address receives security notification and old address receives the currently implemented informational notice; current session invalidation and Google binding remain canonical.
- [ ] Google link requires session/current password and privileged step-up; callback cannot replay; email alone does not auto-link; unlink controls work; no account is stranded; notifications arrive.
- [ ] Account deletion requires password and privileged step-up where applicable; afterward sessions/devices fail and the deleted account cannot authenticate.

### Security notifications and staging key-rotation smoke test

- [ ] Real staged delivery succeeds for password changed/reset, email changed, Google linked/unlinked, authenticator enrolled/replaced, recovery code used, role grant/revoke, and mass session revocation; no secret appears.
- [ ] Add/switch a second TOTP key: old factor works and newly replaced factor records the new ID; keep old key while referenced.
- [ ] Rotate login-device digest: old trust stops bypassing, while password plus OTP works.
- [ ] Rotate pending-auth signing: stale continuation fails closed and a new login works.
- [ ] With a disposable staging account only, rotate recovery digest and verify old recovery codes intentionally fail.

### Reproducible JavaScript toolchain

Use Node 24 and pnpm 10.28.1 exactly. `package.json` is the canonical package-manager declaration and both GitHub workflows pin the same version. pnpm lifecycle scripts remain denied by default except for the reviewed minimum allowlist: `sharp` (native image library installation used by Next.js), `esbuild` (platform binary selection used by build/database tooling), and `@tailwindcss/oxide` (Tailwind's native compiler). Never broaden this list to solve an install warning without reviewing the package and why its build is necessary. A clean `pnpm install --frozen-lockfile` must succeed non-interactively; `scripts/validate-toolchain-policy.mjs` rejects workflow/version or audit-gate drift.

## 15.6 Release signoff evidence checklist

Status semantics are identical in this Markdown list and `docs/25-release-readiness-checklist.json`:
unchecked means evidence is absent or incomplete; verified means a named operator recorded dated,
non-secret evidence. Automation produces artifacts but never edits either status. IDs, descriptions,
ordering, and checkbox status are validated in CI.

**Automatable evidence** (run the command or suite, then an operator records its artifact):

- [ ] `repository-unit-tests` — Repository unit tests pass: __________
- [ ] `database-integration-tests` — Disposable PostgreSQL integration tests pass: __________
- [ ] `security-tests` — Authentication and authorization security tests pass: __________
- [ ] `stripe-test-mode-playwright` — Opt-in Stripe test-mode Playwright flows pass: __________
- [ ] `stripe-webhook-idempotency` — Webhook signature, rollback, replay, ordering, and concurrency tests pass: __________
- [ ] `stripe-configuration-validation` — Canonical Stripe configuration validation passes: __________
- [ ] `migration-schema-checks` — Migration, schema, snapshot, and checksum checks pass: __________
- [ ] `production-migrations-applied` — Production database migrations are applied and migration/checksum evidence is recorded: __________
- [ ] `build-release-checks` — Release build and required workflows pass on the final revision: __________
- [ ] `secret-log-safety-checks` — Secret-free logging and safe-correlation checks pass: __________

**Manual-only evidence** (requires the owner/operator account; repository automation cannot verify it):

- [ ] `stripe-dashboard-webhooks` — Stripe Dashboard webhook endpoint and event configuration confirmed: __________
- [ ] `stripe-restricted-key-permissions` — Stripe Dashboard restricted-key permissions confirmed: __________
- [ ] `stripe-customer-portal-settings` — Stripe Customer Portal settings confirmed: __________
- [x] `production-auth-variables-configured` — Required Production auth variables are configured in Vercel: __________
- [x] `google-production-origin-callback-configured` — Google production origin/callback are configured: __________
- [x] `security-email-delivery-retry-verified` — Security-email delivery and retry operation are verified: __________
- [x] `privileged-totp-enrollment-login-verified` — Privileged TOTP enrollment and password/Google login are verified: __________
- [x] `ordinary-password-otp-remembered-device-verified` — Ordinary password+OTP and remembered-device behavior are verified: __________
- [x] `password-reset-recovery-replacement-verified` — Password reset and authenticator recovery/replacement are verified: __________
- [ ] `step-up-session-role-invalidation-verified` — Fresh step-up, session management, and role-change invalidation are verified: __________
- [ ] `production-vercel-environment` — Production Vercel environment confirmed: __________
- [ ] `production-deployment-confirmed` — Production deployment and exact SHA confirmed: __________
- [ ] `production-smoke-test-passed` — Production smoke test passed against the deployed revision: __________
- [ ] `production-backup-restore` — Production backup and restore confirmed: __________
- [ ] `named-operator-approval` — Named operator approved production release: __________
- [ ] `live-mode-payment-test` — Separately approved live-mode payment test evidence recorded, if required: __________
- [ ] `stripe-test-mode-browser-and-dashboard-evidence` — Stripe test-mode browser matrix and provider evidence are complete: __________

### Security-log ingestion boundary

Security-event metadata is a closed, event-specific categorical schema. Unknown keys and values are
omitted at runtime; subject-attributed events without a positive internal subject ID are suppressed,
anonymous events cannot accept identity metadata, and system events cannot accept human attribution.
Never add request/provider bodies, headers, cookies, exception text, credentials, or client-controlled
error text to the registry. The operational event channel remains separate from durable audit records.

## Membership roster and recorded-revenue reporting

The administrator membership roster provides server-side search, status, expiration-range, federation, country, region, professional-type, sorting, pagination, and matching CSV export. The default view is active memberships. Browser-side column visibility and current-page selection do not grant authority or perform mutations; bulk actions remain unavailable until their account, billing, restoration, session, and audit policies are approved. Member detail uses the existing protected seminar-registration history and displays both current and past associations.

The Revenue navigation item opens the protected recorded-payment report. Its currency-separated cards label gross recorded, Stripe, and manual revenue plus payment count; monthly values and the accessible chart represent persisted successful non-complimentary payment records, not refunds, adjustments, or net revenue. The monthly aggregation query uses an explicitly quoted month alias; its database integration test covers the report load that previously failed with a SQL syntax error.

## Restricted CMS page operations

Administrators manage pages at `/admin/pages`. Every page must select at least one audience and explicitly choose **Match any** (union) or **Match all** (intersection). Administrator preview independently requires Administrator authority. Normal `/pages/[slug]` delivery enforces publication time, entitlement, and active-role checks in its server query, so a guessed slug cannot bypass them. Save operations sanitize rich text and append an immutable revision snapshot and audit entry. Archive a published page before deleting it. Restricted pages emit no-index metadata and must not be linked from anonymous navigation.

## Administrator table operation

The administrator layout provides the Next.js App Router `NuqsAdapter` for URL-driven Dice UI tables. If a table reports `[nuqs] nuqs requires an adapter`, check that the adapter still wraps the administrator route subtree before investigating table queries. The administrator error page can supply the route, timestamp, log reference, and browser stack for diagnosis; review copied details for personal information before sharing them.

The Memberships roster uses the official Dice UI `DataTable`, toolbar, sort list, view options, pagination, `useDataTable`, and selected-row `ActionBar`. It retains server-side full-name/email search, expiration range, federation, address country, IDOC region, membership type, sorting, columns, page size, selection, filtered CSV export, and pagination. Active, Expired, and Archived are reached through the Member status facet filter rather than a separate quick-nav; the roster no longer shows standalone Active/Expired/Archived/Revenue-dashboard links above the toolbar. The status, membership type, federation, country, and region filters are simple single-select facets shown directly next to search -- not an advanced filter-builder panel -- and expiration range uses a calendar range picker; every filter can be combined and all can be cleared together via Reset. The status filter offers Active, Expired, Archived, Administrators, Super Admins, onboarding/migration-pending users, and conventionally named test accounts (`+test`, `example.test`, or `example.com`); Is not Active also reaches users without an active membership, and existing `without_active` URLs remain supported. URL/history changes are authoritative and update controlled toolbar values; saved preferences populate the URL on first load so the displayed controls match server results. Validated preferences remain per administrator and per table across sessions. Country and federation filter choices reuse the profile country's display names and ISO codes, and region choices reuse the profile's IDOC regions. The server applies the selected filter values and ordered sort clauses. Sort and View list fields alphabetically by default; Sort offers only visible fields and its own popover supports adding, editing, reordering, and removing custom multi-column sort clauses. View checkboxes control visibility and each row's drag handle reorders columns left-to-right, saved with each administrator's preferences. Country cells show names, membership type and status use uppercase labels and icons, and the expiration date matches other table dates. The filtered export icon sits at the right edge with a Download These results tooltip, immediately after View at the toolbar's far right, separated from the filters. Reset appears only once a facet or the expiration range is actually set; typing in search alone does not surface it, since the search field carries its own clear control. While a search, filter, sort, page-size, page, or column-visibility change is being applied, the table dims with the same pulse treatment as its initial load instead of appearing unresponsive. Empty, loading, and error states remain explicit, while row links retain the established audited member-detail workflows.

Preferences follow the signed-in administrator across browsers and devices for the five named table identifiers. URL parameters override a saved view for the request. The `DELETE /api/admin/table-preferences/[table]` endpoint still removes a table's saved preference row without changing records or another administrator's settings, but no toolbar exposes it as a button; every table's toolbar now offers only the single **Reset** control, which clears the table's active filters. If saving preferences fails, the URL remains usable and the administrator may retry after refreshing. News, Seminars, and Content Pages now use the same Dice UI table composition and server-backed filtering, sorting, page size, and pagination. Their selected-row CSV export contains only the already-loaded page rows; their direct row links open the established edit, preview, or registration workflow. Membership selection also exports selected visible-page rows through the audited server endpoint, while Support selection can copy conversation links. Notification history and reconciliation findings have read-only Dice UI tables with local controls and server-authorized, audited selected-row exports that omit internal database identifiers. Their local view state does not persist. Publishing, deletion, refunds, account-state changes, and support replies remain in their existing individually authorized workflows.

The administrator layout no longer caps the table area at a fixed maximum width; the roster, News/Blog, Seminars, Pages, Support Inbox, Notifications, and Stripe reconciliation tables stretch to the available viewport width (minus the sidebar and page padding) instead of rendering in a narrow column with unused space, so a wide table still scrolls horizontally only when its own columns need more room than the viewport provides. All administrator data tables share a visibly rounded corner treatment (search field, filter buttons, filter popovers, pagination controls, and the selected-row `ActionBar`'s buttons) distinct from the sharper corners used elsewhere in the product, and each single- or multi-select or date-range filter trigger shows a dashed border to distinguish it from an ordinary button.

Bulk archive, pause, and force-revocation are deliberately not activated by the shared selection menu in this release. Archive requires one approved, retry-safe orchestration spanning Stripe subscription cancellation, retained seminar identity, support retention, Mailchimp removal, session/role state, and immutable audit history. Pause continues to mean the existing audited membership suspension (including its Stripe-cancellation behavior), not a new billing state. Force-revocation remains the existing Super-Admin-only, fresh-MFA incident-response workflow. Operators must use the existing row-level controls until that cross-provider orchestration is approved and tested; direct database edits are prohibited.

Manual membership payments continue through the existing administrator payment form. It validates member ownership, positive EUR amount, date, supported source, reason, and idempotency evidence, writes the administrator and audit trail, and applies the existing entitlement rules. Stripe credentials never enter the browser.

### Seminar and membership refunds

The governing policy is [10 Refund Policy](10-refund-policy.md). Cancellation and payment are separate facts: a member cancellation never refunds automatically, and a paid canceled registration remains Paid. An administrator may approve only a full Stripe refund from the seminar registration screen, must provide a reason, and must complete fresh TOTP step-up. The action returns success only after Stripe responds. Pending, failed, directly-created, partial, disputed, and chargeback provider states remain visible evidence and create reconciliation findings; partial refunds are outside current policy. Never delete or relabel the original payment.

Administrators can likewise approve a full refund of a Stripe membership payment from the protected Payments screen for the two policy cases (an accidental recurring renewal, or a recurring charge after an approved manual payment). Record the exact reason and, for the latter, first record the alternative payment and disable automatic renewal. Canceling renewal before the next charge remains a prospective billing change and must not create a refund. Refund processing never silently rewrites membership entitlement or payment history.

## Stripe payment production readiness

### Environment and provider objects

- Set server-only `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
  `STRIPE_MEMBERSHIP_PRODUCT_ID` in every payment-capable environment. Only a Vercel Production
  deployment actually serving `idoc.club` or `www.idoc.club` (as read from `BASE_URL`) requires a
  live `sk_live_` or preferably least-privilege `rk_live_` key; everything else -- Preview,
  Development, and a Production deployment aliased to any other domain (a temporary redesign
  subdomain such as `redesign.idoc.club`, say) -- must use a test key. Runtime validation
  (`lib/runtime/stripe-configuration.mjs`'s `stripeDeploymentMode`) rejects a live key outside the
  canonical domain and a test key on it (`Invalid Stripe configuration: STRIPE_SECRET_KEY mode does
  not match the deployment.`). Never copy Customers, webhook secrets, Products, Prices, SetupIntents,
  PaymentMethods, schedules, or subscriptions between modes. Product IDs are opaque, so the Stripe
  API's account/mode ownership check is authoritative: verify the configured Product using the
  configured key before signoff. `BASE_URL` and the Stripe mode are two independently configured
  values, not derived from each other or from which domain currently resolves to the deployment:
  aliasing `idoc.club` to a deployment does not itself change that deployment's `BASE_URL`, and
  changing `STRIPE_SECRET_KEY` alone does not change `BASE_URL` either. Neither change alone is a
  safe go-live: swapping in the live key while `BASE_URL` still reads the temporary subdomain fails
  closed (checkout breaks with the mode-mismatch error above), while aliasing `idoc.club` to the
  deployment without updating `BASE_URL` does not -- it silently keeps accepting the test key while
  now serving real member traffic, so real cards fail against Stripe test mode instead of loudly
  erroring. Go-live is therefore one coordinated change: update `BASE_URL` to `https://idoc.club`,
  swap in the live key, and redeploy, all before (or atomically with) switching the canonical domain
  alias -- never one of these steps on its own.
- In each mode create one active **IDOC Annual Membership** Product. The application creates EUR
  80.00 inline one-time/recurring Prices and future-transition recurring Prices under that Product;
  no browser amount, currency, Product, Price, Customer, profile, ownership, date, or refund value is
  authoritative. Seminars deliberately use server-locked title and dynamic EUR price data and do
  not use the membership Product or membership payment ledger.
- Restrict the runtime key to the Checkout Sessions, Customers, Billing Portal, PaymentMethods,
  SetupIntents, Prices, Subscriptions, Subscription Schedules, Invoices, Refunds, and read-only
  reconciliation list operations used by the application. Validate the exact restricted-key
  permission set in test mode: required calls succeed and an unrelated write is denied. Keep the
  Stripe Dashboard restricted to separately controlled administrator accounts.

### Webhook and Portal configuration

Create exactly one endpoint per environment at `https://<origin>/api/stripe/webhook`, with its own
signing secret, raw request delivery, and these events:

`checkout.session.completed`, `payment_intent.succeeded`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
`invoice.payment_failed`, `invoice.payment_action_required`, `refund.created`, `refund.updated`,
`refund.failed`, `charge.refunded`, `charge.dispute.created`, and `charge.dispute.closed`.

The route verifies the signature against the raw body before database work. It records the Stripe
event ID transactionally; handler failure rolls back that marker and returns an error so Stripe can
retry, while successful replay is a no-op. Unknown verified events are acknowledged and retained as
processed evidence. Never log payloads, headers, secrets, full payment details, provider responses,
or unnecessary personal data. Use server-generated correlation IDs and categorical safe events.

Configure Customer Portal in both modes for payment-method management and invoice history. Permit
subscription cancellation at period end, not plan/product switching or immediate cancellation.
IDOC Billing Settings remains the renewal-preference authority and ownership is checked server-side.

### Test-mode acceptance and browser checkpoints

Run against a disposable migrated PostgreSQL database, a dedicated Stripe test account, the normal
authentication fixtures, and real webhook signatures. Retain redacted event/object IDs, timestamps,
screenshots, and database assertions for:

The opt-in repository entry point is `STRIPE_E2E_ENABLED=true pnpm test:stripe-e2e`; its complete
environment contract and evidence split are in [Stripe verification evidence](09-stripe-verification-evidence.md).
Ordinary CI intentionally does not run this provider-backed suite. Missing credentials, a live key,
an unsafe database target, an unavailable Product, or an unreachable application is a hard failure
after opt-in, never a skip.

1. One-time €80 Checkout, submitting animation, return-without-entitlement, verified webhook,
   rolling dates/history, refresh/back/double-click, expiry/stale form, and cross-member denial.
2. Recurring Checkout, invoice webhook, subscription/paid-through/next-period display, Portal
   payment-method management, cancel-at-period-end, and access retained through paid-through.
3. One-time to recurring Setup Checkout: no immediate charge or entitlement change; exact
   paid-through schedule start; expected €80 plus Checkout, SetupIntent, PaymentMethod, Price and
   Schedule references; cancellation; replay/concurrent double-click without duplicate objects.
4. Supported failed renewal: exact five-calendar-day grace and deduplicated notice; repeated failure
   cannot reset grace; after grace only payment/logout remain accessible.
5. Two published seminars with different names/prices: separate successful registrations and no
   change to membership entitlement, dates, subscription, or membership payment history.
6. Member cancellation without refund; then administrator full refund with normal sign-in, CSRF,
   fresh TOTP, reason/confirmation, ownership, ledger/audit/notification/reconciliation evidence.
   Exercise a terminal failure (fresh attempt/key), uncertain transport outcome (same attempt/key),
   direct refund matching, recurring-membership cancellation, partial/unmatched refund, dispute,
   and lost chargeback without changing unrelated entitlement.

Automation must not bypass authentication, inbox verification, TOTP, authorization, Stripe-hosted
Checkout/Portal, or provider challenges. A challenge that cannot be safely automated is a genuine
manual checkpoint and its operator evidence must be recorded. Repository fakes and Playwright
security tests do not satisfy this real-provider gate. **Do not claim live payment testing unless
IDOC supplied the live credentials/account and the resulting live evidence was independently
verified.** Use only minimal controlled amounts if a separately approved live test is performed.

### Deployment, replay, reconciliation, and incident procedures

1. Back up PostgreSQL; verify `idoc` schema ownership and migration checksum history; apply every
   migration through `0051`; run the disposable-database integration/migration checks; then verify
   tables, constraints, indexes, and generated Drizzle snapshot/journal match the committed schema.
   Do not enable refund UI or webhook traffic on a revision whose schema migration is incomplete.
2. Deploy with payment traffic disabled, validate `/api/health`, Cron `CRON_SECRET`, provider mode,
   Product, Portal, webhook destination/events, and notification delivery. Run reconciliation and
   preserve its run row before enabling Checkout. Roll back application traffic—not financial
   history—if signatures, migrations, ownership, notifications, or reconciliation fail.
3. For webhook replay, locate the event in the correct Stripe mode, record its ID and reason, confirm
   the endpoint revision/configuration, use Stripe's resend operation, and verify one processed
   `stripe_events` row plus the expected projection. Never edit the event ID or manually manufacture
   payment success. A failed local transaction remains retryable because its event marker rolled back.
4. For a failed payment, confirm the original renewal date and immutable grace end, notification
   delivery/retry state, access during grace, and payment-only access afterward. A later successful
   verified payment restores/extends access; repeated failures never move either date.
5. Run scheduled reconciliation with authenticated Cron and inspect its append-only run history.
   Successful scans refresh only subscription/schedule findings. Event-sourced refund, missing-refund,
   dispute, chargeback, and seminar-payment-conflict findings survive later scans until explicitly
   resolved or superseded; a failed scan retains the last known snapshot and records failure.
6. For refunds, preserve every attempt and provider evidence. A provider-confirmed terminal failure
   permits a fresh attempt and idempotency key. An uncertain transport/local outcome retries the
   original attempt/key. Never downgrade provider-confirmed success because later local work failed.
   Match direct refunds by immutable payment relationship; investigate unmatched/partial cases,
   disputes, and chargebacks in Stripe and the reconciliation screen. A successful recurring
   membership refund must also disable renewal; failure to do so is an operational finding.
7. Notification delivery failure never reverses financial state. Inspect the durable outbox's
   retry/dead-letter evidence, correct provider configuration, and retry delivery without replaying
   the payment/refund mutation. Escalate dead letters and Cron failures through the operations channel.

Rotate a Stripe API key by creating a same-mode restricted key, validating it in the protected
environment, updating the environment variable, deploying, exercising read-only reconciliation plus
a controlled test-mode transaction, then revoking the old key. Rotate a webhook secret by creating a
replacement endpoint (or provider-supported overlap), deploying its secret, sending a signed test
event, and only then disabling the old endpoint/secret. Never overwrite Production with test values
or rotate Product IDs as if they were secrets; changing the Product is a reviewed billing migration.

Production enablement evidence must include the exact deployed commit, migration/checksum output,
mode and redacted key prefix, Product/Portal/webhook configuration, complete subscribed-event list,
successful signed delivery/replay/idempotency, test-mode browser matrix, restricted-key denial,
reconciliation run, Cron authentication, notification delivery, database backup/restore readiness,
and named operator approval. Missing evidence is a release blocker, not permission to infer success.
