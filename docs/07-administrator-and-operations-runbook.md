**IDOC**

**Administrator & Operations Runbook**

## Signup and password reset breach checks

Password creation during signup and password reset checks the new password against Have I Been Pwned's free Pwned Passwords range endpoint. The application computes a SHA-1 hash server-side and sends only its first five hexadecimal characters; it compares the returned suffixes locally. The password and full hash are never sent. A breached match is rejected with a request to choose another password. Provider outages are recorded as an unavailable check and do not block password creation.

The same password creation policy is used wherever users create or change a password: signup, password reset, account recovery/activation, and authenticated password change. Login checks the existing credential without applying creation-only composition rules.

The test password `Password#1` is the designated breached-password fixture. It is 10 characters and meets IDOC's uppercase, lowercase, number, and special-character requirements. CI uses it in `tests/password-breach-check.test.ts` and stubs the corresponding HIBP range response so the rejection test is deterministic. For a live staging check, use `Password#1` only with a disposable test identity and verify that HIBP reports a match; follow LIVE-AUTH-034 in the Authentication & Security Test Catalog. Never use it for a real account.

## Dashboard navigation and Organization Settings

- Administrators and Super Admins enter through **Admin Dashboard** in the authenticated initials menu. Members do not receive that server-derived menu capability and `/admin` remains default-deny.
- Shared operational destinations appear before the separate Super Admin group in the responsive left navigation. A missing link is not an authorization control: every page and mutation rechecks current server-managed grants.
- Organization Settings, support-category defaults, and security operations are Super-Admin-only. Direct access by an Administrator is translated to the standard branded not-found response.
- **Email previews** is the final item in the Super Admin navigation. It is unavailable on Vercel Production and requires current Super Admin authorization plus CSRF validation. The preview sender delivers the canonical current transactional-email HTML to the fixed review inbox `zangfuqi@gmail.com` using safe sample values; it does not create users, OTPs, account tokens, payments, memberships, seminar registrations, or other workflow state. Preview subjects are prefixed with `[PREVIEW]`, sample links/codes are intentionally invalid, and **Send all** reports each failed template so an operator can retry only those messages rather than guessing which deliveries succeeded.
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

Selecting a member (`?profileId=`, the one query param this app still uses for a short-lived,
single-step selection) opens a tabbed right-side Sheet rather than navigating to a separate page or
jumping to an anchored section: Overview (seminar and payment history, read-only), Edit Info,
Membership (extend expiration, correct entitlement, suspend/reinstate), Payment, Security
(suspend/reinstate sign-in), Roles (Super Admin only: application roles plus the incident-response
Force Revoke), Notifications (that member's delivery history), and Audit Trail. An optional `&tab=`
param opens a specific tab directly -- e.g. the roster's Payment action link opens straight to the
Payment tab; a request for the Super-Admin-only Roles tab from a non-Super-Admin falls back to
Overview rather than rendering an empty panel. Payment History (Overview tab) is a newest-first,
member-scoped safe projection of the persisted ledger. Seminar History is re-authorized for an
administrator and scoped to the server-resolved member before reading registration records. The
Payment tab is also where a manual payment is recorded and where refundable Stripe payments are
listed for refund, and the Notifications tab is that member's read-only notification delivery
history (same Dice UI read-only table `/admin/notifications` used) -- there is no separate
`/admin/payments` or `/admin/notifications` destination or navigation entry for either anymore; both
routes now only redirect into this Sheet's corresponding tab (see docs/26 for auth-risk handling of
these route changes). Every tab's fields are grouped into rounded card sections that lay out in a
responsive grid (multiple cards per row on wide viewports, one column on narrow ones) rather than a
flat vertical stack. Email Member (in the Sheet header) is only a `mailto:` link to the current
canonical account address.

The roster's row actions also include a Support-conversations shortcut that opens `/admin/support`
with the search box pre-filled to that member's email, showing only their conversations; it is
disabled when the member has never submitted a support conversation, regardless of any existing
conversation's current status.

The Members roster has separate **Archive selected** and **Delete selected** bulk actions. Archiving disables member sign-in and revokes sessions while retaining the profile and all related records; it is blocked while a Stripe membership subscription is active, which must be canceled first. Permanent deletion removes the account, profile, membership, payment/refund, registration, profile-change, support, and account-security records. Audit events remain in the append-only log, with the deleted member's actor reference cleared. Permanent deletion is blocked while an active subscription exists. Both actions reject the acting administrator's own account and privileged Administrator/Super Admin accounts, require fresh MFA step-up and CSRF validation, and show the table's pulsing skeleton while the change and refresh run. The incident-only Super Admin action
**Force Revoke All Authority**; it is not an ordinary canonical Revoke User operation and must not
be reinterpreted as Bulk Revoke. Product owners must define ordinary revoke eligibility, effects,
privileged/self protections, notices, and retry semantics before Bulk Revoke can be enabled. A
future enabled bulk operation must re-fetch every ID, re-authorize and re-evaluate eligibility,
confirm access removal, prevent duplicate submission, preserve filters, and report per-member
success/failure/skipped outcomes.

The roster's **Archive selected** action disables sign-in and preserves the membership and registration records; it is an account-level archive. The separate membership-status transition **Archive Membership** remains unavailable until durable Stripe/Mailchimp external-operation handling and seminar-registration identity snapshots exist. Pause Membership remains unavailable until
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

## Shared rich-text image sizing

News/Blog and seminar rich-text fields use the shared Tiptap editor. Administrators may select an inserted Cloudinary image and drag its lower-right resize handle. The editor persists the chosen width as a numeric HTML `width` attribute. Server sanitization accepts that attribute only for otherwise-approved Cloudinary image URLs and only when the width is between 120 and 2000 pixels; invalid or out-of-range widths are removed. The public rendering path re-sanitizes the saved HTML and preserves the same validated width, while responsive styling prevents an image from overflowing its content container.

## Codex pull-request review request

Codex automated review is advisory. When a pull request is opened or updated, the workflow requests a Codex review and exits promptly without polling. The `codex/review-complete` status is informational only and is not required by either branch ruleset; it does not certify review completion. Any Codex comments or inline findings remain visible for the author to address, while fast and risk-classified full CI workflows determine test readiness.

The repository owner removed `codex/review-complete` from both required-check lists on 25 September 2026. Keep `Fast PR checks` required. Full release and authentication/security workflows remain required by the merge procedure whenever `docs/26-ci-risk-classification-and-agent-merge-policy.md` classifies the change as requiring them. Staging acceptance and the live or manual checks required by this runbook remain mandatory before a staging-to-main promotion.

## Branch, environment, and deployment workflow

Two long-lived branches drive the two live Vercel deployments referenced throughout this document. There is no other route to either domain: a change reaches `staging.idoc.club` or `redesign.idoc.club` only by landing on the branch that feeds it.

| Branch | Vercel environment | Domain | Purpose |
|---|---|---|---|
| `staging` | Preview (a dedicated, always-on Preview deployment, not an ephemeral per-PR one) | `staging.idoc.club` | Where every change is verified before it ships: UAT, migration rehearsal, and the Claude Code Cloud live-auth audit (`docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md`). Enforced by the GitHub ruleset `staging-protection` (§ below). |
| `main` | Production | `redesign.idoc.club` today; becomes `idoc.club`/`www.idoc.club` at the go-live domain cutover (§ "Stripe payment production readiness" below) | The real deployment. Enforced by the GitHub ruleset `main-protection` (§ below). Receives only reviewed promotions from `staging`, never a feature branch directly. |

**Enforcement is a GitHub ruleset on each branch, not just this document.** Both `main-protection` and `staging-protection` (`Settings → Rules → Rulesets`) require `Fast PR checks` to pass before any ref update — merge or direct push alike, since a fresh commit has no recorded check runs until it has gone through a PR. The legacy `codex/review-complete` context is not required; it is informational only. Applicable full workflows remain mandatory under the agent procedure and risk-classification policy below. Neither ruleset has any bypass actor configured, deliberately: any GitHub identity acting under the repository owner's account — including Claude Code Cloud, which performs its GitHub actions as the owner via the installed GitHub App — would otherwise inherit an owner-scoped bypass, defeating the point of the gate. Before 25 September 2026, `main` had no GitHub-enforced protection at all; `codex/review-complete` being "required" was a convention Claude and Codex followed voluntarily, not something GitHub actually blocked on. Both branches are now genuinely enforced.

**Staging is deliberately near-identical to production, not a separate sandbox.** `staging.idoc.club` and `redesign.idoc.club` read/write the *same* Render PostgreSQL instance and share most of the rest of the environment-variable inventory verbatim (`AUTH_SECRET`, the MFA encryption/signing keys, `CRON_SECRET`, `RATE_LIMIT_HASH_KEY`, `IDOC_ADMIN_NOTIFICATION_EMAIL`, and more — see §15.1 below for the full inventory and exactly which rows differ). This is deliberate: it is what makes verification on staging predictive of how a change will actually behave once promoted, and it avoids paying for a second Render Postgres instance. What structurally has to differ stays distinct even under this policy:

- Each environment's own `BASE_URL`/`GOOGLE_OAUTH_REDIRECT_URI`.
- The Turnstile keys (staging uses Cloudflare's always-pass testing pair, scoped to the `staging` branch, since an automated Claude Code test run cannot solve a real interactive challenge).
- `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (§ "Stripe payment production readiness" below): both environments currently use a test key together only because `redesign.idoc.club` isn't the canonical domain yet. At the go-live domain cutover, Production must switch to a live key while `staging.idoc.club` (a Preview deployment) must keep using a test key — sharing this value verbatim would fail closed on one side or the other the moment that cutover happens (`lib/runtime/stripe-configuration.mjs`'s `stripeDeploymentMode`), so Stripe credentials are never part of the "shared" set even though they happen to match today.
- `BREVO_API_KEY`/`BREVO_WEBHOOK_KEY` (§15.1 below): kept distinct so staging's automated test traffic never sends through, or trips webhook signature checks against, the real production Brevo account.

Because of this near-total sharing:

- Any account, membership, or test data created against `staging.idoc.club` is real production data. Clean it up (see `docs/security/CLAUDE_LIVE_AUTH_RUNBOOK.md`'s cleanup rules); don't treat it as disposable.
- **A migration must be backward-compatible with whatever code is still live on `main`, not merely "safe to run once."** Verifying a staging-only change applies its migration to the *same* database `main`'s still-live, not-yet-promoted code is currently reading and writing — the shared database means a migration bypasses the promotion gate entirely, taking effect on `redesign.idoc.club` immediately regardless of whether its own code has been promoted yet. A destructive change in the same migration (a dropped column/table, a newly-required constraint) can break production mid-verification, before the corresponding code ever ships. Use an additive expand/contract pattern instead: add new columns/tables nullable or defaulted, backfill, and only drop the old shape in a later migration after the code that stops needing it has been promoted. This repository has shipped destructive migrations before (`0035_remove_webauthn_passkeys.sql`, `0037_remove_redundant_user_name.sql`); treat that pattern as unsafe to repeat for a staging-verified-but-not-yet-promoted change under this policy. `main` and `staging` share one `idoc.__drizzle_migrations` ledger.
- Stripe test-mode acceptance runs (§ "Stripe payment production readiness" below, `docs/25` §8) execute against this same shared database — test payments and entitlements land in real production data and need the same cleanup discipline as any other staging test data, not a separately isolated schema.
- **Known unresolved risk, not yet fully mitigated: most queues `/api/cron/account-delivery` drains have no environment partition.** Seminar registration confirmations are the exception: staging uses `seminar.staging_registration_created`, which the production seminar worker does not claim, and staging attempts delivery itself. Stripe seminar Checkout sessions also carry a server-authored `deliveryOwner` plus staging-specific checkout kind; this prevents ownership from being inferred from whichever shared Stripe webhook endpoint wins the race. Staging-origin Stripe events use a staging-scoped dedupe key so the staging handler can process them even if the legacy production endpoint recorded the raw Stripe event ID first. Because Vercel preview deployments do not receive their own cron schedule, staging confirmation retries stay immediately eligible and are exhausted within the same explicit worker invocation rather than depending on a nonexistent staging cron.  That one route (`app/api/cron/account-delivery/route.ts`) processes four separate shared tables in sequence, and every one of them has the same gap: `claimAccountDelivery()` (`lib/notifications/account-delivery.ts`, `idoc.account_delivery_outbox`), `processAuthSecurityNotificationBatch()` (`lib/notifications/auth-security-delivery.ts`, `idoc.auth_security_notification_outbox`), `processOperationalAlertBatch()` (`lib/notifications/operational-alert-delivery.ts`, `idoc.operational_alert_outbox`), and `processStripeCustomerEmailSyncBatch()` (`lib/payments/customer-email.ts`, `idoc.notification_outbox`) each lease the oldest eligible row with no predicate distinguishing which deployment queued it. Distinct `BREVO_API_KEY`/`BREVO_WEBHOOK_KEY` values (above) do not fix this for any of them: if this Cron endpoint is ever invoked against `staging.idoc.club` (e.g. for a staging Cron UAT check per §12.1 below) while a real production row is queued in *any* of the four, staging can claim and send it — a password reset, a security/operations alert, or a Stripe customer-sync job — through staging's infrastructure (and, once Stripe credentials diverge at the go-live cutover, against test-mode Stripe instead of the real one). The reverse (production claiming a staging test row) is less harmful but still wrong. All four queues need partitioning by deployment (an origin/environment column plus a claim predicate, or fully separate queues) before it's safe to invoke this Cron endpoint against real data; until that lands, treat any staging Cron UAT of this endpoint as unsafe to run for real and get explicit operator sign-off first.

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
Administrators and Super Admins operate the Support Inbox at `/admin/support`; the navigation count is the number of conversations with unread member messages. Its Dice UI Data Table toolbar performs search next to simple per-column filters (category, status, and assignment as multi-select checkbox facets, plus an activity date range), a custom multi-column sort list, drag-to-reorder column visibility, and pagination on the server. Table preferences are stored per administrator in the database and apply across sessions and devices when the URL does not supply an explicit view. Row selection currently provides only a safe clear-selection action; conversation mutations remain inside the authorized thread workflow. Conversations may be assigned to multiple administrators; opening a thread advances only the current administrator's read cursor and never clears another assignee's unread state. Replies, assignment/reassignment, close, and reopen are server-authorized and serialized against the conversation. Reopening derives `Admin Responded` or `Member Replied` from the latest immutable message. Super Admins configure one or more category-default administrators at `/admin/support/defaults`; a changed default affects new conversations only, and an empty assignment is rejected. Deploy migrations `0039`, `0042`, and `0043` before use. Never copy message bodies into the general audit log or request authentication secrets in support.
Administrators and Super Admins operate the Support Inbox at `/admin/support`; the navigation count is the number of conversations with unread member messages. Every search/filter/sort/column/page-size/page change is read from and written straight to the signed-in administrator's saved preferences in the database, never to the URL -- opening the inbox always renders the administrator's last saved view, with a clean `/admin/support` address bar throughout. Its Dice UI Data Table toolbar performs search next to simple per-column filters (category, status, and assignment as multi-select checkbox facets, plus an activity date range), a custom multi-column sort list, drag-to-reorder column visibility (this View popover, shared by every admin table, always lists currently-visible columns above hidden ones), and pagination on the server. Every admin table's columns size themselves to their own content rather than a fixed width, and each table's Actions column stays pinned to the table's right edge (visible even while scrolled horizontally). Table preferences are stored per administrator in the database and apply across sessions and devices when the URL does not supply an explicit view. Row selection currently provides only a safe clear-selection action; conversation mutations remain inside the authorized thread workflow. Conversations may be assigned to multiple administrators; opening a thread advances only the current administrator's read cursor and never clears another assignee's unread state. Replies, assignment/reassignment, close, and reopen are server-authorized and serialized against the conversation. Reopening derives `Admin Responded` or `Member Replied` from the latest immutable message. Super Admins configure one or more category-default administrators at `/admin/support/defaults`; a changed default affects new conversations only, and an empty assignment is rejected. Deploy migrations `0039`, `0042`, and `0043` before use. Never copy message bodies into the general audit log or request authentication secrets in support.

## Member Support and public contact

Entitled non-privileged members open the Contact menu item at `/contact` to create support conversations and review their ticket list. Each thread is available at `/contact/[publicId]`; its shared BackLink returns to the list at `/contact`. Contact remains the generic public form for anonymous visitors, unentitled members, and privileged accounts. Legacy member support URLs at `/dashboard/support` redirect to Contact. Administrators and Super Admins continue to use `/admin/support`.

## News/Blog operations

Administrators and Super Admins manage News/Blog articles at `/admin/news`: create, edit, preview, publish, unpublish, schedule, archive, and delete. Deploy migrations `0040`, `0064`, `0065`, and `0070` before use.

- **Fields:** publication date (UTC), title, subtitle (optional), rich-text content, publication status, member access, and slug (auto-generated from the title if left blank, editable afterward, and rejected on collision). Rich-text authoring uses the shared Tiptap Simple Editor form-field implementation, whose toolbar provides one HTML source control that opens editable markup, an image-upload control that stores JPG, PNG, WEBP, and AVIF files up to 4 MB in Cloudinary and inserts them into the content, plus a visible Full screen control that expands the editor to a full-viewport workspace; Escape exits fullscreen without closing the form drawer. Saved HTML continues through the existing server-side sanitization path.
- **Access:** Public is the default and is visible signed in or signed out. All logged-in Members is visible only to authenticated members whose current membership passes the shared entitlement check (including an active payment-grace period where applicable). Alternatively select any combination of Judge, Steward, and Veterinarian; those role selections use Match any. Judge & Steward combo memberships match both Judge and Steward. Public and All logged-in Members each stand alone and cannot be combined with any other access choice. The server enforces these rules for listings, direct article URLs, homepage feeds, and metadata; the client-side selector is not the security boundary.
- **States:** Draft (never visible to readers), Scheduled (never visible until its publication date passes), Published (visible only to its configured audience), Archived (never visible to readers, retained for history).
- **Publishing:** "Publish now" makes an article public immediately; editing the status field to Scheduled with a future publication date defers it. A Vercel Cron job (`/api/cron/news-scheduled-publish`, every 5 minutes, UTC, gated by `CRON_SECRET`) transitions overdue scheduled articles to Published automatically. Public pages independently re-check `publication_date<=now()` on every read, so an article can never appear early even if a transition is delayed.
- **Deletion:** only Draft or Archived articles can be permanently deleted. Archive a Published or Scheduled article first — this preserves a retained record before an irreversible delete, matching the same "deactivate before delete" preference used elsewhere in this runbook (Organization Settings payment methods, §1).
- **Preview:** the edit page's Preview link renders the article exactly as the public page would, for any status, without making it publicly reachable.
- Every create, edit, publish, unpublish, schedule, archive, and delete action is audited under `news_article` entity type; the scheduled-publish Cron transition is audited with a null actor (a system action).
- Legacy IDOC News and President's Blog content from the old `idoc.club` WordPress site is a one-time import via `scripts/data-import/legacy-idoc-club-content-import.sql`; see docs/03 § 10 for the source mapping, assumptions, and reconciliation.

## Seminar operations

### Creating a seminar registration as an administrator

From **Admin → Registrations**, use **New Registration** to open the Registration drawer. Select the seminar and enter the registrant's first name, last name, email, and international phone number. The payment-method selector contains only currently enabled **Bank Transfer** and **Cash** methods from Organization Settings; if neither is enabled, an administrator must enable one there before creating a registration.

The server matches the submitted email to an existing profile when possible. Matching a profile does not automatically grant member pricing: current entitlement is evaluated using the same entitlement rules as the public/profile registration flow. Entitled profiles receive the member price; lapsed, suspended, expired, review-required, or otherwise non-entitled profiles remain attached to their profile but receive the non-member price. Unmatched emails create guest registrations at the non-member price.

A successful create closes the drawer and refreshes the Registrations table. The operation is capacity/deadline checked, duplicate-safe, audited under the administrator actor, and queues the standard branded seminar confirmation. Admin-created registrations never create Stripe Checkout sessions.



Administrators and Super Admins manage seminars at `/admin/seminars`: create, edit, search/filter, and download one seminar's own registrations as CSV via the icon button on its edit page. Seminar Status is also editable inline in the table row using the same Draft / Published / Canceled choices and branded icon treatment as the full form; canceling inline preserves the same registration-cancellation cascade and audit behavior as canceling from the edit form. The Registrations item below Seminars in the admin nav (`/admin/seminars/registrations`) is the cross-seminar roster: every registration, member or guest, searchable by registrant name/email and filterable by seminar (published only), payment status, and registration date range, with sort, column visibility, and a download-all-filtered-results icon. Clicking a seminar row's Registrations action (or the icon on its edit page) opens that same page pre-filtered to the clicked seminar. Editing a registration opens a drawer with its own details, registration-status control, and payment recording. Members register and cancel their own registrations at `/seminars`; a signed-out visitor sees the same catalog and can register as a guest, with no account. Deploy migrations `0041`, `0055`, `0056`, `0057`, and `0058` before use.

Legacy seminar announcements from the old `idoc.club` WordPress site are a one-time import via `scripts/data-import/legacy-idoc-club-content-import.sql`; see docs/03 § 10 for the source mapping and required administrator review (two imported seminars are left in Draft pending a currency correction).

- **Fields:** title, start date, end date, location, language, organizing National Federation, capacity, a member price and a non-member price (both EUR), registration deadline, publication/registration status, an FEI-affiliation toggle, Levels, and the rich-information fields Course Directors, Participant Profile, Course Venue Information, Application, and Accommodation Information. Those rich-information fields use the shared Tiptap Simple Editor form-field implementation while preserving the existing sanitized HTML storage contract. There is no seminar-level payment method — a registrant chooses one of the three canonical Organization Settings methods currently enabled when they register. Time-of-day and timezone are not seminar product inputs; seminar scheduling is date-only.
- **FEI-affiliation flag:** a simple boolean toggle (`idoc.seminars.is_fei`, migration `0057`) an administrator sets on the seminar form. It is purely a display badge — the FEI logo shows small in the bottom-right corner of that seminar's listing cards and larger on its own detail page — and has no effect on eligibility, pricing, capacity, or any other workflow.
- **Levels:** a multi-checkbox admin control (`idoc.seminars.levels`, migration `0058`) offering Level 1, Level 2, Level 3, and All Levels. Checking All Levels always discards any individually-checked level — a seminar's levels are either a specific subset or the single value All Levels, never both — and displays as the literal text "All levels" everywhere a seminar's levels are shown (the detail page's icon-block list, directly above the FEI logo). A seminar with no level checked shows no Levels row at all.
- **Multi-day seminars:** the end date must be on or after the start date. A same-day seminar (`start_date = end_date`) displays as one date everywhere a registrant sees it; a seminar spanning multiple days displays the full start-to-end date range instead.
- **Two prices, chosen by current entitlement:** a signed-in profile with current membership entitlement pays the member price. A signed-in profile without current entitlement remains profile-backed but pays the non-member price. An anonymous guest also pays the non-member price. The public catalog shows both prices side by side so the incentive to join is explicit.
- **Publication status:** Draft (never public), Published (open for registration subject to capacity/deadline), Canceled (retained and visibly canceled for affected registrants rather than deleted). **Canceling a seminar cascades**: every still-Registered registration is canceled in the same transaction. Stripe cleanup then runs through the resumable cancellation worker: paid online registrations are automatically refunded and open Checkout Sessions are expired. Failed provider work remains retryable and records reconciliation evidence; already-canceled registrations are left alone.
- **Member-facing availability** is derived, never stored: Open, Full (active registrations reached capacity), Registration closed (past the deadline), or Past (the seminar has ended) for a Published seminar; Draft and Canceled seminars show their own state. The registration deadline and actual end date/time determine these transitions server-side; the public/member views re-derive them on every read rather than trusting a cached value.
- **Registration status and payment status are independent facts.** Registration status is Registered or Canceled. Payment status is Unpaid, Pending, Bank transfer pending, Cash pending, Paid, Refunded, Partially refunded, Refund failed, Disputed, or Chargeback, and reflects the registrant's own chosen payment method. Canceling a registration never overwrites its payment history (useful evidence if a refund is later decided outside this system).
- **A registration belongs to exactly one identity**: a real member profile, or a guest identified by name and email — never both, never neither (enforced by a database check constraint). A guest is deduplicated per seminar by a case-insensitive email match (a partial unique index), the same guarantee the member path gets from its own `(seminar, profile)` unique index.
- **Capacity and duplicate-registration enforcement** is transactional: registering locks the seminar row, re-counts active registrations, and checks for an existing row for that member or guest email before inserting or reactivating one, so two registrants racing for the last seat cannot both succeed and the same member or guest email cannot hold two active registrations for the same seminar. Canceling and re-registering reuses the same row.
- **Guest (anonymous, non-member) registration:** a signed-out visitor is offered two explicit choices — join IDOC to unlock the member price, or continue as a guest at the non-member price with no account. For Bank Transfer or Cash, IDOC collects first name, last name, email, and a valid international phone number in the registration dialog, with client-side validity plus independent server-side validation, CSRF, Turnstile, and rate limiting. For Online via Stripe, the flow is Stripe-first: IDOC collects no duplicate contact form before redirect; Stripe Checkout collects email and phone plus required First name and Last name custom fields. The paid webhook revalidates provider data, seminar state, deadline, capacity, amount, currency, and duplicate email before creating the guest registration. Guest confirmations use the same durable notification outbox and branded renderer as profile registrations; a null `profile_id` is valid because the delivery recipient is snapshotted in the payload.
- **Payment collection by method:**
  - *Online via Stripe*: profile-backed registration creates the registration before Checkout and marks it Paid only after the verified paid webhook; anonymous guest registration is Stripe-first and creates the registration only after verified payment. The webhook verifies the completed session's amount, currency, identity binding, and seminar state before granting credit. If a paid anonymous Checkout can no longer become a valid registration, the system attempts an idempotent automatic refund and records reconciliation evidence if manual attention is required. Seminar payment never touches membership entitlement.
  - *Bank Transfer*: registering sets the registration to Bank transfer pending and shows the same sanitized, organization-wide instructions Super Admins maintain in Organization Settings (§ above) — a seminar never stores its own copy. An administrator marks the registration Paid manually, from the registration's edit drawer, specifying Bank Transfer and an optional reference, once the transfer is confirmed received.
  - *Cash at the Event*: registering sets the registration to Cash pending; an administrator marks it Paid manually the same way, specifying Cash at the Event, at or after the event.
- **Immutability:** once a seminar has any registration, neither its member price nor its non-member price can be changed (editing rejects the attempt with a clear error); capacity can be increased freely but cannot be reduced below the current count of active (Registered) registrations. All other fields, including status, remain editable at any time.
- **CSV export**: one seminar's own registrations (`/api/admin/export/seminar-registrations?seminarId=…`, from that seminar's edit page) or every registration matching the Registrations page's current filters (`/api/admin/export/seminar-all-registrations?…`, from that page's download icon). Both expose only seminar title, registrant name, registrant email, whether the registrant is a guest, registration status, payment status, payment method, and the three relevant timestamps (registered/canceled/paid); both are capped at 25,000 rows and audited with the actor, scope, and result count — the same conventions as the existing member/payment/audit-log exports (§ above).
- Every seminar create, edit (including a status change), cascade-cancel, and registration/payment mutation (member or guest registration, member cancellation, an administrator's registration-detail edit, status change, or manual-payment confirmation, and the Stripe webhook's payment confirmation) is audited.

## Members Directory and Map operations

There is no administrator management interface for this feature — both surfaces read the existing member/profile/membership tables directly and there is nothing to author. No migration is required.

- **Public map** (`/about/members-directory`, unauthenticated): aggregates currently-entitled members by country. Signed-out visitors see only the map, with no directory view tabs; signed-in users see the map/directory tabs, and a signed-out request for `?tab=directory` still renders only the map. A country is shown only once it has at least `DIRECTORY_MIN_AGGREGATION_THRESHOLD` (`lib/directory/aggregate.ts`, currently 5) members — an operator who needs to raise or lower this threshold changes that one constant and its accompanying tests/docs reference, and should treat lowering it as a privacy-sensitive change requiring the same review rigor as any other change in [05 Security and Privacy Requirements](05-security-and-privacy-requirements.md#3-member-data-isolation-objectives). A database error while computing the map is caught and logged as the `directory_map_query_failed` security event (operational retention) rather than surfacing a raw error to the public; repeated occurrences warrant the same triage as any other operational alert (§ Security event logging below).
- **Paid member directory** (the member-only tab at `/about/members-directory?tab=directory`): entitled members and administrators/Super Admins may access it; results contain only active member accounts, excluding archived, suspended, and administrator/Super Admin accounts. It provides member email addresses and a one-click email action for member-to-member contact. The UI uses the shared admin Members data table with live search, multi-select facets (membership type, federation, IDOC region), sortable columns, page-size choices of 10/25/50/100, and first/previous/next/last pagination controls. Changing search, a facet, sort order, or page size applies to server-backed results directly; there is no filter-submit action. National Federation is shown, and the redundant Country column and filter are omitted. Results are capped at 5,000 reachable records and search at 100 characters. Search is rate-limited per account and per origin using the existing rate-limit facility (`member_directory_search` purpose — see [05 Security and Privacy Requirements](05-security-and-privacy-requirements.md#rate-limiting-independent-ip-and-normalized-email-limits)) — a member who reports being blocked mid-session should simply wait a few minutes before retrying; this is not an account-level lockout and does not require administrator intervention.

This runbook defines normal administrative actions, exception handling and escalation boundaries. It is intended to prevent ad-hoc database edits and preserve a reliable audit trail.

# 2. Normal member lookup

1. Search by name, email, legacy ID or external billing identifier as permitted.

2. Confirm identity using more than one field before making sensitive changes.

3. Review membership status, valid-through date, professional roles and payment source.

4. Review recent audit entries before changing a disputed record.

# 3. Record a bank transfer, PayPal or cash payment

1. Open the existing member record.

2. Open the Payment tab.

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
account's active authenticator factor and never sends or falls back to an email OTP. If the factor
is unavailable or missing, direct the person through approved identity-verification and support
handling; do not enroll or replace an authenticator inside anonymous recovery. If the user retained a recovery code, they must complete password or Google primary sign-in, choose recovery at the MFA challenge, replace and prove a new authenticator, and acknowledge newly rotated recovery codes. This self-service event revokes prior sessions; support must never request a recovery code or authenticator secret. Successful reset
revokes all persisted sessions and requires a fresh sign-in.

5. If email delivery is failing, investigate provider logs and account email rather than creating a duplicate account.

# 10. Member says membership is incorrectly expired

1. Check valid-through date and status.

2. Review recent payments and Stripe subscription/current period if Stripe-backed.

3. Review manual payment records and audit history.

4. Correct only after evidence identifies the intended entitlement.

5. Record reason/source for any manual extension.

6. Confirm the five-calendar-day grace rule was applied whether the prior term ended after a failed recurring charge or a non-recurring paid-through date. During grace the person retains full member access; after grace the account receives only payment and logout.

# 11. Security incident escalation

- Suspected unauthorized administrator access: revoke affected sessions/credentials and escalate immediately.

- Suspected secret leakage: rotate the affected Vercel, Render PostgreSQL, application-authentication, or Stripe secret, then investigate logs and the exposure window.

- Suspected cross-member data exposure: disable affected feature if necessary and treat as a privacy/security incident.

- Webhook signature failures: verify endpoint/secret configuration; never bypass signature verification to restore service.

- Database integrity anomaly: preserve evidence/backups before attempting broad corrective writes.

# 12. Routine operational checks

| **Frequency**      | **Check**                                                                                                                       |
|--------------------|---------------------------------------------------------------------------------------------------------------------------------|
| Daily/regularly    | Failed Stripe webhooks, renewal failures, review-required members, application errors.                                          |
| Weekly             | Manual payment exceptions, unresolved migration anomalies during stabilization, unusual admin actions.                          |
| Monthly            | Active member counts versus billing/manual-payment expectations; access review for administrators.                              |
| Quarterly          | Dependency/security updates, authorization and member-data-isolation spot-check, and Render PostgreSQL backup/recovery posture. |
| When staff changes | Immediately remove or adjust administrative access.                                                                             |

## 12.1 Vercel Pro operational controls

| **Area** | **Procedure** |
|---|---|
| Preview access | Share protected previews only with current project reviewers; never use Preview to inspect or edit production member data. |
| Environment variables | Enter, rotate and remove secrets only in approved Vercel project settings and target environment; never paste them in tickets, PRs, logs, screenshots or chat. |
| Firewall/WAF | Document purpose, scope and rollback before changes, then test affected account, admin and Stripe flows. |
| Observability/logs | Record deployment, timestamp, safe error ID and affected workflow; do not export unredacted member data or secrets. |
| Scheduled jobs | Check prior effects before retries; escalate repeated failure, missed runs and duplicate-effect evidence. |

### Account-delivery schedule

Configure `CRON_SECRET` as a sensitive, server-only Vercel environment variable in Production; documentation, tickets, logs, and source control must never contain its value. Vercel Cron calls `/api/cron/account-delivery` on `*/5 * * * *` (every five minutes, UTC). A run handles at most 20 account-link records. Monitor non-sensitive delivered, retryable, dead-lettered, ineligible, and lease-lost counts; investigate repeated failures without recording member addresses, tokens, decrypted payloads, credentials, keys, exception text, or environment values. An expired or otherwise invalid queued link is not replaced by the worker; the member must make a new neutral recovery or activation request.

Retry delay is `min(3,600, 30 × 2^(attempt − 1))` seconds according to the current attempt number; attempt six is retained as dead-lettered and is not claimable again. Do not manually clear a live lease. Reconciliation may reclaim an expired lease, but the stable message identifier must be preserved so a provider success followed by a database-finalization failure cannot create an uncontrolled new identity. Cron responses expose only aggregate delivered, retryable, dead-lettered, ineligible, and lease-lost counts.

### Stripe reconciliation-scan schedule

Vercel Cron calls `/api/cron/reconciliation-scan` on `0 7 * * *` (daily, UTC — an hour after the renewal-notice scan). It is gated by the same `CRON_SECRET` bearer header as every other Cron route. A run replaces the current findings snapshot only on success; a failure (e.g. Stripe temporarily unreachable) leaves the prior snapshot untouched and is recorded as a failed run, and the Cron route itself returns a non-2xx status so a missed or broken run is visible in Vercel's own Cron monitoring, not just on the `/admin/reconciliation` page. Investigate a run of consecutive failures the same way as any other Cron failure (§12) before assuming a specific finding is stale.

### News scheduled-publish schedule

Vercel Cron calls `/api/cron/news-scheduled-publish` on `*/5 * * * *` (every five minutes, UTC), gated by the same `CRON_SECRET` bearer header as every other Cron route. A run transitions every `news_articles` row with `status='scheduled'` and a `publication_date` at or before the current PostgreSQL `now()` to `status='published'`, in one transaction per article with `FOR UPDATE SKIP LOCKED`, and writes one audit row per transition with a null actor (a system action). The public site independently re-checks `publication_date<=now()` on every read regardless of this Cron's cadence, so a brief delay between an article's scheduled time and this job's next run never makes it appear early — only, at most, a few minutes later than scheduled.

### Data-retention-purge schedule

Vercel Cron calls `/api/cron/data-retention-purge` on `0 8 * * *` (daily, UTC — an hour after the reconciliation scan), gated by the same `CRON_SECRET` bearer header as every other Cron route. Each run permanently deletes rows from `email_otp_codes`, `mfa_challenge_transactions`, `mfa_enrollment_transactions`, `account_tokens`, `auth_sessions`, and `login_trusted_devices` once each row's own expiry is more than 30 days in the past (`lib/security/data-retention-purge.ts`). This is routine, expected data loss by design — do not treat a nonzero delete count as an anomaly requiring investigation, and do not attempt to restore purged rows from a backup (§12.2): they were already logically unauthorized well before physical deletion.

## 12.2 Render PostgreSQL backup and recovery

The production database runs on Render, whose **Hobby** plan includes two backup mechanisms automatically — nothing in this codebase implements or manages either of them:

- **Point-in-time recovery (PITR).** Render continuously archives write-ahead log data. On the Hobby plan, this gives a **3-day recovery window** — a new database can be restored to any point within the last 3 days. (Render's Pro tier and above extend this to 7 days; upgrading does not retroactively extend an already-elapsed window, only going forward.)
- **Logical backups.** Render also retains an exportable logical (`pg_dump`-style) backup, created and retained for **7 days**, downloadable from the Render dashboard.

**What this means operationally:**

- A data-corruption or destructive-write incident discovered **within 3 days** can be recovered via PITR — restore to a new Render Postgres instance at a timestamp just before the bad write, verify, then cut the application over (`POSTGRES_URL`) to the restored instance. This is a Render dashboard operation, not something scripted in this repository.
- An incident discovered **after the 3-day window has elapsed** cannot be recovered via PITR at all — this is the single most consequential fact an operator must know about this backup posture, and is exactly why the quarterly check below exists.
- A restore is a genuinely destructive, production-affecting operation (a new database instance, a `POSTGRES_URL` cutover, and a window of data loss between the incident and the restore point) — treat it with the same care as any other action in this category (see the top-level operating principles this document opens with), and prefer read-only investigation via a database export or replica-like inspection before deciding a restore is actually necessary.

**Quarterly verification (§12's existing "Render PostgreSQL backup/recovery posture" line refers to this procedure):**

1. Confirm in the Render dashboard that the production database is still on a paid plan (PITR and logical backups are **not** available on Render's free tier at all) and that PITR is showing as active with a 3-day (or better) window.
2. Confirm a recent logical backup exists and is downloadable.
3. This is a posture check, not a restore drill — actually restoring to a scratch/staging Render instance to prove the procedure works end-to-end is valuable but is a separate, deliberate exercise to schedule on its own, not something to perform against production as part of this routine check.

### Mandatory post-restore reconciliation

A point-in-time restore rolls the entire database back to an earlier moment — including every security-relevant row this application relies on being current. A restore that is not followed by this reconciliation can silently **resurrect** a session, account, or role grant that had been correctly revoked between the restore point and the incident. This is not optional cleanup; complete it before resuming production traffic against the restored database:

1. **Rotate `AUTH_SECRET` immediately, using the hard-cutover procedure (§15.2), not the graceful-overlap one -- including its step to clear `AUTH_SECRET_RETIRED_KEYS` entirely.** Every session cookie is a JWT signed with this secret and is only ever honored alongside a matching, non-revoked `idoc.auth_sessions` row — but a restore can bring back a since-revoked row (its `revoked_at` un-set again) exactly as it existed at the restore point. `AUTH_SECRET` supports a graceful, non-disruptive overlap rotation for routine use (§15.2), but this specific situation calls for the opposite: clear any existing `AUTH_SECRET_RETIRED_KEYS` entries (a routine rotation's overlap window may still be active) and set a new `AUTH_SECRET` value, so every existing session JWT is invalidated regardless of what the restored database now says, closing this off unconditionally rather than depending on a manual per-row audit to catch every case.
2. **Re-apply any account suspension, deletion, or role revocation that happened between the restore point and the incident.** Compare the restored `idoc.users.account_state`/`deleted_at`, `idoc.memberships.status`, and `idoc.application_roles.revoked_at` against the most recent pre-incident audit-log export (`/admin/exports`) or admin recollection of recent actions, for that specific window. Manually re-apply anything the restore rolled back (re-suspend, re-delete, re-revoke) before treating the restored database as authoritative.
3. **TOTP/session encryption keys need no restore-specific action.** Key material lives in Vercel environment configuration, not the Postgres database, so a database restore cannot resurrect a key that was deliberately removed from the active key ring for being compromised — a restored `mfa_factors` row encrypted under a since-removed key simply fails to decrypt (a safe failure), it does not become usable again.

# 13. Data export and reporting

Administrative exports should be generated through authorized server-side reporting functions. Export only the fields necessary for the stated business purpose and avoid distributing raw migration exports or unnecessary billing identifiers.

## 13.1 Stripe reconciliation report

Any administrator can view `/admin/reconciliation`, a read-only report refreshed daily by the reconciliation-scan Cron job (see §12.1). It lists the current findings — subscription status conflicts, orphaned active Stripe subscriptions, repeated payment failures, and unlinked Stripe Customers (docs/04 §9) — and the timestamp/outcome of the last run, so a stopped or failing job is visible rather than silently read as "no anomalies." The page performs no writes of its own; act on a finding as described in §7's table.

# 14. Decommissioning legacy IDOC WordPress membership

1. Keep the archival legacy export/backup available through the agreed stabilization period.

2. Confirm all post-cutover discrepancies are resolved.

3. Take an archival export/backup according to IDOC retention requirements.

4. Remove obsolete MemberPress/IDOC payment webhooks and scheduled jobs only after confirming the new platform is authoritative.

5. The other former multisite sites will already have been retired independently; retire the IDOC WordPress site only after acceptance is complete.

6. Document the final decommission date and retained archive location.

## Production runtime configuration boundary

Production runtime requires explicit `POSTGRES_URL`, `AUTH_SECRET`, HTTPS `BASE_URL`, `ACCOUNT_DELIVERY_KEY_VERSION`, `ACCOUNT_DELIVERY_ENCRYPTION_KEYS`, `RATE_LIMIT_HASH_KEY`, `CRON_SECRET`, `BREVO_API_KEY`, `BREVO_FROM_EMAIL`, `IDOC_ADMIN_NOTIFICATION_EMAIL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MEMBERSHIP_PRODUCT_ID`, `TURNSTILE_SECRET_KEY`, `MFA_PENDING_AUTH_SIGNING_KEY`, `MFA_TOTP_ACTIVE_KEY_ID`, `MFA_TOTP_ENCRYPTION_KEYS`, and `MFA_RECOVERY_CODE_DIGEST_KEY`. Secrets must be at least 32 characters where applicable, the Stripe membership Product ID must match Stripe's `prod_...` identifier shape, and each active key/version must resolve to material in its corresponding key ring. Never add compilation placeholders. A deployment build intentionally succeeds without these values, while each privileged runtime boundary fails closed until its real configuration exists. The former recurring/one-time Product variables are obsolete after migration `0047` deploys; retain them only for rollback until the new revision is healthy.

The live privileged-MFA variables use these formats:

- `MFA_PENDING_AUTH_SIGNING_KEY`: base64url-encoded key material representing at least 32 random bytes; rotate by replacing the value and expect outstanding pending-MFA continuations signed with the retired key to require a fresh primary login.
- `MFA_TOTP_ACTIVE_KEY_ID`: the active TOTP encryption-key identifier, for example `v1`.
- `MFA_TOTP_ENCRYPTION_KEYS`: a server-only JSON object mapping accepted key IDs to base64url-encoded **exactly 32-byte** AES-256 keys, for example `{"v1":"..."}`. Keep old key IDs present while factors encrypted under them still exist; re-encrypt/rotate factors before removing a retired key ID.
- `MFA_RECOVERY_CODE_DIGEST_KEY`: base64url-encoded key material representing at least 32 random bytes. Rotating it invalidates outstanding recovery-code digests unless they are regenerated under the new key, so coordinate rotation with privileged-account recovery-code replacement.

Store all four as sensitive server-only Vercel environment variables in every environment where privileged MFA login is expected to work. Do not expose them through `NEXT_PUBLIC_*`, logs, screenshots, tickets, or documentation values. Before production enablement, verify the active TOTP key ID exists in `MFA_TOTP_ENCRYPTION_KEYS` and perform an Administrator/Super Admin enrollment-and-login UAT pass; a missing or malformed value intentionally fails closed and can otherwise lock privileged users out.

The signup/login/password-reset Turnstile challenge additionally requires `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (client-visible by design — it identifies the Turnstile widget, not a secret) alongside the server-only `TURNSTILE_SECRET_KEY` above. Without the public key the widget renders nothing and the signup submit button stays permanently disabled; without the secret key every server-side verification fails closed.

`STRIPE_MEMBERSHIP_PRODUCT_ID` identifies the one IDOC Annual Membership Product against which Checkout builds recurring or non-recurring €80 Price configurations. Stripe requires different Price configurations for the two billing modes, not separate Products. The Product and both technical Price modes represent the same membership entitlement and are never shown as competing plans.

The Stripe restricted key must permit Customer, Checkout Session, SetupIntent, PaymentMethod and
Price reads/creation plus Subscription, Subscription Schedule, Invoice, Refund, reconciliation-list,
and Billing Portal operations used by the application. Configure the complete webhook list in
“Stripe payment production readiness” below; do not use an abbreviated subset. Unknown signed events
are retained as processed evidence and never alter
entitlement. A pending automatic-renewal schedule may be canceled from Billing Settings; operators
must investigate any local pending state whose Schedule is missing or disagrees with Stripe rather
than silently repairing ownership or billing identifiers.

The five-minute account-delivery Cron also retries `stripe.customer_email_sync` jobs. It ignores
the queued payload's identifiers and re-resolves the profile-owned Customer and current verified
email on every leased attempt, applies bounded exponential backoff, and dead-letters after eight
failed attempts for administrator follow-up.


## Ordinary login trusted-device operations

Set `LOGIN_DEVICE_TRUST_DIGEST_KEY` to a dedicated base64url-encoded secret of at least 32 random bytes in every runtime that serves password login. Keep it server-only and do not reuse session, password, TOTP-encryption, or recovery-code keys. Losing or rotating this single active key safely invalidates all existing ordinary-member trusted-device cookies; deploy the new key consistently before relying on newly issued trust. Individual or account-wide emergency revocation can set `idoc.login_trusted_devices.revoked_at` and an operational `revoke_reason`; revocation takes effect on the next login. Do not delete or mutate factor-bound `mfa_remembered_devices` for this purpose.

## Account-security management operations

Members manage password, Google sign-in, active canonical sessions, remembered ordinary login devices, privileged authenticators, and deletion at `/dashboard/security`. Each active session also shows a short, derived device/browser label (e.g. "Chrome on macOS"), captured from that session's own request at creation time -- this lets a member tell their own devices apart from an unrecognized one, which is the point of offering per-session revocation. Support should still never invent a browser, device, location, or IP description beyond what the member's own page already shows them: the session registry stores only this derived label plus authentication, activity, and absolute-expiry timestamps -- never the raw User-Agent string, and never location or IP. "Log out other sessions" intentionally preserves the server-bound current session; password change and account deletion intentionally require fresh sign-in.

Administrator and Super Admin users never use ordinary remembered-login-device trust. Their security page links into the established authenticator recovery/replacement flow, which requires current TOTP or a one-time recovery code, rotates recovery codes, invalidates sessions, and requires acknowledgement before a fresh normal session. Item 8's broader notification and audit sweep remains an operational follow-up; this surface adds only mutation evidence consistent with current audit conventions.

## Security-notification operations

The five-minute account-delivery Cron also drains durable authentication-security notices. Each notice snapshots its recipient and event creation time, retries with the existing six-attempt exponential policy, and dead-letters after attempt six. Provider failure never reverses a password, email, factor, role, or session mutation. Operators may inspect only kind, user ownership, timestamps, attempt/lease state, dedupe identity, and categorical delivery error. Never add credential material, raw session/device identifiers, IP/location guesses, exception text, or provider responses to evidence. A dead-letter requires confirming current account ownership before an approved manual communication; never re-run the underlying security mutation merely to send email.

## Public contact-form notification

The public `/contact` page (`app/(marketing)/contact/`) collects a name, email, subject, and message from an anonymous visitor and relays it by email to the secretariat (`accounts@idoc.club`) via the same Brevo Transactional sender every other notification in this application uses (`lib/notifications/brevo-transactional.ts`). This is deliberately the simplest delivery shape in the application, not a member of the durable-outbox/retry-queue family described above: the message carries no account, membership, or security significance, so a failed send is not queued, retried, or dead-lettered. The Server Action (`app/(marketing)/contact/actions.ts`) synchronously attempts delivery once; on failure the visitor sees an inline error and may resubmit, with a fresh Turnstile challenge (each token is single-use). Abuse controls match the rest of the application's anonymous-form surfaces: Cloudflare Turnstile (action `contact`), the signed double-submit CSRF cookie, and the same dual email+origin rate-limit bucket (`checkRateLimit('contact_form', ...)`, `lib/security/rate-limit.ts`) other unauthenticated flows use. No new environment variables or operator action are required -- it reuses the already-documented `TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`BREVO_API_KEY`/`BREVO_FROM_EMAIL` values from section 15 below. Operational ownership is the secretariat inbox itself; there is no dedicated dashboard, outbox table, or Cron sweep for this path.

## Security event logging (AUTH-LOG-001, AUTH-LOG-003)

`lib/observability/logger.ts`'s `logWarn`/`logError` emit only names registered in
`lib/observability/security-events.ts`'s `SECURITY_EVENT_TAXONOMY` -- an unregistered name is a
TypeScript compile error. Every emitted line carries a server-generated correlation id (never
client-supplied), the taxonomy's `category`, `resource`, `attribution`, and `retentionClass`; callers
cannot override those registry-owned fields. Each event accepts only its own closed allowlist of
categorical metadata keys and values. Unknown, free-form, nested, oversized, secret-bearing, or
incorrectly attributed metadata is omitted, and a subject-attributed event without a positive internal
subject ID is suppressed. The anonymous `client_error` event records occurrence and correlation only,
never client-supplied message, stack, URL, or digest text. This deployment has no separate self-hosted
log store; Vercel's platform retention governs actual duration. Configure the platform retention window
to keep `retentionClass: 'security'` lines available for at least 90 days where the plan permits;
`operational` lines may use the platform default. Never add request/provider bodies, headers, cookies,
exception text, credentials, or other free-form client/provider content to an event schema.

Security events (`lib/observability/logger.ts`) remain a distinct channel from `idoc.audit_log` (`docs/07` elsewhere, `lib/db/schema.ts`): the audit log is the actor-attributed, append-oriented record of security-sensitive state *changes*; the security-event log is operational/diagnostic and covers failures, not committed mutations.

## Sentry application error monitoring

Sentry is the centralized application-error inbox for genuine browser, React, Next.js server,
route-handler, Server Action, Edge, and explicitly caught background-worker failures. It does **not**
replace the categorical security-event logger above or `idoc.audit_log`. In particular, expected
login failures, authorization denials, rate limits, invalid input, provider webhook signature
rejections, and expected registered `logWarn`/`logError` outcomes must not be forwarded to Sentry merely
because they were logged. Automatic Next.js instrumentation handles uncaught failures; explicit
captures are limited to unexpected exceptions that a worker catches and prevents from escaping.

Sentry SDK PII collection, performance tracing, and Session Replay are disabled. A defense-in-depth
`beforeSend` sanitizer removes request bodies, form/payload data, query strings and values, cookies,
authorization headers, token/password/MFA/recovery/payment fields, and all user attributes other than
an explicitly supplied internal numeric ID. Do not add raw provider responses or application inputs
as Sentry extras. When Sentry sees the middleware-generated `x-request-id`, it records it as the
searchable `idoc_request_id` tag and `idoc.request_id` context. The existing occurrence-only
`/api/client-error` route remains: an error boundary uses the fresh ID it returns for both its support
reference and its direct browser-SDK capture, while the route continues to receive `{}` and never an
exception message or stack.

Configure the following in Vercel, with Preview values scoped to the `staging` branch where
appropriate:

| Variable | Exposure | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Browser-safe/public | Enables browser and server event ingestion. A DSN is an ingest identifier, not an authentication secret. Use the Sentry project's client-key DSN. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Browser-safe/public, optional | Explicit environment label such as `staging`. If absent, the server derives `production`, `staging` (Preview deployment of the staging branch), `preview`, or `development` from Vercel/Node metadata. Set this explicitly for the browser bundle on stable staging. |
| `SENTRY_AUTH_TOKEN` | **Build-only secret** | Sentry token authorized only to upload release artifacts/source maps to the existing `pixelsmith-platform` organization and `idoc` project. The Vercel Marketplace integration normally supplies this value. Never expose it with a `NEXT_PUBLIC_` prefix or make it available to application users. |

Enable Vercel's automatically exposed system environment variables so `VERCEL_ENV`,
`VERCEL_GIT_COMMIT_REF`, and `VERCEL_GIT_COMMIT_SHA` identify deployments and releases. The Sentry
project already exists as `pixelsmith-platform/idoc` and is linked through the Vercel Marketplace;
do not create or link another project. Confirm that the integration supplies its DSN and build-only
source-map upload token to the intended Vercel environments, add only the optional environment label
where needed, redeploy, and confirm that the build log reports a successful artifact upload without
printing the token. The build deletes emitted browser source maps after upload so they are not
publicly served.

For a safe local verification, set a non-production DSN and run
`NODE_ENV=development pnpm exec tsx scripts/verify-sentry.ts` for the server event. For a browser
event, run `pnpm dev`, open the local application, and execute
`setTimeout(() => { throw new Error('IDOC local browser Sentry verification'); })` in browser developer
tools. Both mechanisms rely on local access and credentials; no production error-trigger route is
provided. Confirm each event in Sentry, confirm its environment/release, and inspect the event to
ensure no cookies, authorization data, request body, query values, email, or IP address arrived.

# 15. Production authentication configuration and UAT

This section is the authoritative production-auth configuration inventory. The application is one Vercel-hosted Next.js deployment; its Cron route runs in that deployment and no separate authentication worker is deployed elsewhere. Put server-only values in **Vercel Project Settings → Environment Variables**. **`staging.idoc.club` is deliberately near-identical to production, not an isolated environment**: it intentionally shares `POSTGRES_URL`, `AUTH_SECRET`, the MFA encryption/signing keys, `CRON_SECRET`, `RATE_LIMIT_HASH_KEY`, and most of the rest of the inventory below verbatim with production (see "Branch, environment, and deployment workflow" above) — this is what makes staging's verification predictive of how a change will actually behave once promoted, and avoids paying for a second Render Postgres instance. The values that structurally have to differ do: `BASE_URL`/`GOOGLE_OAUTH_REDIRECT_URI` (each environment's own domain), the Turnstile keys (staging uses Cloudflare's own always-pass testing pair, scoped to the `staging` branch, because an automated Claude Code test run cannot solve a real interactive challenge), `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (must diverge at the go-live domain cutover — production needs a live key, staging/Preview always needs a test key), and `BREVO_API_KEY`/`BREVO_WEBHOOK_KEY` (kept distinct so staging's test traffic never hits real production email infrastructure). Each row below says explicitly which case it is. All instances within one environment must receive the same compatible values. Never put real values in `.env.example`, Git, documentation, issues, pull requests, chat, screenshots, build output, or runtime logs.

## 15.1 Authoritative inventory

“Rotate” below means an operator-coordinated deployment, never an application-generated fallback.

| Variable | Requirement, consumer, and format | Rotation and environment rules |
|---|---|---|
| `AUTH_SECRET` | Required server-only UTF-8 text of at least 32 characters. `lib/auth/session.ts` uses it as the active HS256 JWT signing key for the canonical session cookie; it also signs OAuth browser binding and other short-lived transient authorities (pending signup/login/password-reset, Google-link fresh evidence). | Must match across instances. See the rotation procedure below: an ordinary rotation is now a graceful overlap for session cookies, not a hard cutover. The short-lived transient authorities (all ≤15 minutes) are still a hard cutover on rotation by design -- simply retrying that step is a negligible cost, and they were left out of the ring to keep this change minimal. Shared with production, not a distinct staging value. |
| `AUTH_SECRET_RETIRED_KEYS` | Optional server-only JSON array of prior `AUTH_SECRET` values, each at least 32 characters. Unset (the default) is a single-key ring identical to before this variable existed. | Not itself rotated -- populated and drained as part of the `AUTH_SECRET` rotation procedure below. Never include the *current* `AUTH_SECRET` value in this list. |
| `BASE_URL` | Required absolute application origin. HTTPS is mandatory in production; loopback HTTP is accepted only outside production. Used for trusted application origins and links. No trailing route; production is `https://idoc.club` when that is the deployed canonical origin. | Not secret. Must match across instances and the deployed origin. A change requires OAuth/callback and email-link review; use the actual staging origin in staging. |
| `POSTGRES_URL` | Required server-only `postgres:`/`postgresql:` URL for the Render PostgreSQL database; production requires provider TLS configuration. Stores users, session registry, factors, challenges, devices, audit, and durable notification outbox. | Rotate the database credential using Render/Vercel coordination. It does not logically revoke auth material, but an incompatible cutover makes auth fail closed. **Deliberate exception:** `staging.idoc.club` intentionally uses this exact same value as production — see "Branch, environment, and deployment workflow" above. Do not stand up a second Render Postgres instance for staging without an explicit decision to reverse this. |
| `MFA_TOTP_ACTIVE_KEY_ID` | Required 1–30 character key ID (`A-Z`, `a-z`, digits, `_`, `-`). Selects the encryption key for newly enrolled factors and must exist in the TOTP ring. | Not secret, but must match the ring on every instance. Change only as part of the additive procedure below. Shared with production; staging does not have an independent ring. |
| `MFA_TOTP_ENCRYPTION_KEYS` | Required server-only JSON object from key ID to **unpadded canonical base64url**, each decoding to exactly 32 bytes (AES-256-GCM). Decrypts persisted privileged TOTP factors. | Must be compatible across instances. Additive rotation is safe; old IDs must remain until no factor references them. Removing a referenced key locks out that factor. Shared with production, not a distinct staging ring. |
| `MFA_TOTP_COMPROMISED_KEY_IDS` / `MFA_TOTP_RETIRED_KEY_IDS` | Optional server-only JSON arrays of non-secret key IDs already present in `MFA_TOTP_ENCRYPTION_KEYS`. Unset (the default) is empty for both. A key ID may be in at most one list. `COMPROMISED` blocks the ID from new encryption and from decrypting old factors; `RETIRED` is an operator declaration that a key is fully decommissioned, cross-checked at read time against real `idoc.mfa_factors` usage (`mfaEncryptionKeyLifecycle`) rather than trusted blindly. | Declare `COMPROMISED` immediately on suspected exposure -- it takes effect on deploy, independent of the `AUTH_SECRET` compromise procedure below. Only add an ID to `RETIRED` after the same database inventory required by step 5 of the TOTP rotation procedure confirms no live (`pending`/`active`/`disabled`) factor references it; the app flags a mismatch rather than silently trusting a wrong declaration. Shared with production. |
| `MFA_RECOVERY_CODE_DIGEST_KEY` | Required server-only unpadded canonical base64url decoding to at least 32 bytes. Keys persisted one-time recovery-code digests. | Must match across instances. Rotation intentionally invalidates every existing recovery code; old values are not consulted. Coordinate regeneration/re-enrollment and test only with a disposable staging account. Shared with production, not distinct per environment. |
| `MFA_PENDING_AUTH_SIGNING_KEY` | Required server-only unpadded canonical base64url decoding to at least 32 bytes. Signs short-lived MFA enrollment/login/reset/replacement/step-up continuation authority. | Must match across instances. Rotation safely invalidates outstanding continuations; no old key is needed. Begin fresh flows after deployment. Shared with production. |
| `LOGIN_DEVICE_TRUST_DIGEST_KEY` | Required server-only unpadded canonical base64url decoding to at least 32 bytes. Keys digest-only persisted ordinary-member 14-day login-device tokens. | Must match across instances. Rotation safely invalidates all remembered ordinary devices; no old key is needed. It does not bypass password+OTP recovery. Shared with production. |
| `GOOGLE_OAUTH_CLIENT_ID` | Required when Google auth is enabled; Google-issued server configuration consumed by the canonical OIDC flow. | Must match the configured OAuth client across instances. Not secret. |
| `GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS` / `GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION` | Required together, server-only: a JSON object from a 1-30 character version label to the corresponding Google-issued secret, plus the version label currently in use. There is no plain single-secret fallback -- a deployment that never rotates still sets both, with a single entry in `VERSIONS`. Setting `ACTIVE_VERSION` without a matching entry in `VERSIONS` fails closed. | Add the new version to `VERSIONS` before flipping `ACTIVE_VERSION` to it; keep the prior version in `VERSIONS` for rollback (revert the pointer only, never re-enter the secret) until no instance needs it. After deploying with the new version active and completing a real Google sign-in, a Super Admin opens `/admin/security` and selects **Record completed rotation**. The action requires fresh MFA, reads the active version on the server, records no secret material, and is safe to retry. `pnpm google:rotate-secret` remains the non-browser fallback. The same Google Client Secret is valid across all of that client's registered redirect URIs, so production and staging may share the same ring; only `GOOGLE_OAUTH_REDIRECT_URI` itself must differ per environment. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Required absolute HTTPS callback URI outside local development. It must be exactly `${BASE_URL}/api/auth/google/callback` for the deployed canonical origin and exactly match a Google authorized redirect URI. | Not secret; exact-match across instances and provider console. Each stable protected staging origin needs its own explicit callback. Do not use arbitrary per-PR hosts with the production client. |
| `BREVO_API_KEY` | Required server-only Brevo-issued transactional API key (provider-defined length). Delivers login OTP and durable security/account messages. | Rotate in Brevo and Vercel; queued messages remain in PostgreSQL and retry with the new credential. It does not invalidate auth material. Use a non-production account/key or tightly controlled test subaccount in staging. |
| `BREVO_FROM_EMAIL` | Required syntactically valid sender address for every transactional email (`accounts@idoc.club` in production). All Brevo transactional messages use the fixed visible sender name `Accounts`. | Must be a verified sending identity in Brevo. Changing the address does not invalidate auth material; confirm the new address is verified before deploying. The visible sender name is application-controlled and must remain `Accounts` unless this documented contract is intentionally changed. |

**Transactional sender invariant:** every message emitted through Brevo from `accounts@idoc.club`—including signup/login OTPs, verification, password/security/MFA-related notices, account notifications, membership/seminar confirmations, operational alerts, and contact-form mail—must use the single `lib/notifications/brevo-transactional.ts` transport. That transport sets the visible sender name to `Accounts`; application code must not call Brevo's SMTP endpoint directly.
| `BREVO_WEBHOOK_KEY` | Required server-only random text of at least 32 characters. Brevo does not sign webhook deliveries, so this value is instead required as a `key` query parameter on the Notify URL configured in Brevo's dashboard for bounce/complaint events. | Rotate by updating both the Notify URL in Brevo's dashboard and this value together; a mismatch causes webhook deliveries to be rejected (400) until both sides agree. Distinct per environment. |
| `CRON_SECRET` | Required server-only random text of at least 32 characters. Vercel Cron presents it as `Authorization: Bearer …` to `/api/cron/account-delivery`; the worker handles retry/dead-letter delivery. | Must match all instances and scheduler. Rotation can temporarily cause 401s and delay mail but does not invalidate auth state; update scheduler/deployment compatibly. Shared with production. |
| `ACCOUNT_DELIVERY_KEY_VERSION` / `ACCOUNT_DELIVERY_ENCRYPTION_KEYS` | Required active 1–30 character version plus server-only JSON version ring. Ring values are the existing encrypted-outbox key format (at least 32 characters). Protects raw, short-lived account-link payloads until delivery. | Add the new value/version before switching active; retain old versions until no pending row references them. Removal makes affected pending deliveries fail safely. Shared with production, not a distinct staging ring. |
| `RATE_LIMIT_HASH_KEY` | Required server-only random text of at least 32 characters. Keys privacy-preserving authentication-adjacent rate-limit identifiers. | Must match across instances. Rotation loses continuity of existing rate-limit buckets and should occur only during a controlled window; it does not revoke sessions/factors. Shared with production. |
| `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Required Cloudflare server verification secret (at least 32 characters under runtime validation) and intentionally public site key. Protect anonymous auth boundaries. | Configure as a matched Cloudflare widget pair for each allowed hostname. Secret is server-only; site key may reach browsers. Rotation does not revoke auth material. Do not reuse production's real secret in staging. **Exception:** `staging.idoc.club` (which shares the real `idoc.club`-domain widget's hostname allowlist) deliberately uses Cloudflare's own public "always passes" testing key pair instead of a second real widget, so the Claude Code live-auth audit can complete Turnstile-gated flows unattended; `verifyTurnstile` (docs/21 AUTH-TURNSTILE-006) accepts that pair's fixed response shape only when the deployment's own hostname is exactly `staging.idoc.club` (a positive allow-list, not merely "outside Production") and `VERCEL_ENV !== 'production'`. |
| `IDOC_ADMIN_NOTIFICATION_EMAIL` | Required syntactically valid operations recipient for privileged production configuration alerts/workflows. Also the recipient for breached-password rejection alerts (docs/21 AUTH-PASSWORD-007) and the `Contact:` address published at `/.well-known/security.txt` (docs/21 AUTH-SUPPLY-002) — one operations mailbox, not a separate secret per purpose. | Not cryptographic; keep consistent across instances. Shared with production, not a separate staging recipient. |
| `DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING` | Server-only launch hold. Exact `true` blocks; exact `false` releases. Missing, empty or invalid values block. Validated Stripe sandbox billing remains available; all outgoing email is held. | Configure separately for Production and branch-scoped staging Preview; keep both `true` during migration. Release Production only after the [launch checklist](27-member-communications-and-billing-launch-hold.md). Changing either value requires redeployment; held queues/webhooks never replay suppressed work automatically. |

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

Administrators manage pages at `/admin/pages`. Every page must select at least one audience and explicitly choose **Match any** (union) or **Match all** (intersection). Administrator preview independently requires Administrator authority. Normal `/pages/[slug]` delivery enforces publication time, entitlement, and active-role checks in its server query, so a guessed slug cannot bypass them. Save operations sanitize rich text and append an immutable revision snapshot and audit entry. Page rich-text authoring uses the same shared Tiptap Simple Editor form-field implementation as News/Blog and seminar rich-information fields. Archive a published page before deleting it. Restricted pages emit no-index metadata and must not be linked from anonymous navigation.

## Administrator table operation

The administrator error page can supply the route, timestamp, log reference, and browser stack for diagnosis; review copied details for personal information before sharing them.

The Memberships roster uses the official Dice UI `DataTable`, toolbar, sort list, view options, pagination, `useDataTable`, and selected-row `ActionBar`. It retains server-side full-name/email search, expiration range, federation, address country, IDOC region, membership type, sorting, columns, page size, selection, filtered CSV export, and pagination. Active, Expired, and Archived are reached through the Member status facet filter rather than a separate quick-nav; the roster no longer shows standalone Active/Expired/Archived/Revenue-dashboard links above the toolbar. The status, membership type, federation, country, and region filters are simple multi-select checkbox facets shown directly next to search -- not an advanced filter-builder panel -- and expiration range uses a calendar range picker; every filter can be combined and all can be cleared together via Reset. Checking multiple boxes in one facet, or picking a start and end date, only applies once the popover closes (clicking away or pressing Escape) rather than refetching after every click, so an administrator can select several values before the table updates; Reset also clears an in-progress, uncommitted date range. Reset shows a spinner on the button itself while its clear is in flight. The status filter offers Active, Expired, Archived, Administrators, Super Admins, onboarding/migration-pending users, and conventionally named test accounts (`+test`, `example.test`, or `example.com`); Is not Active also reaches users without an active membership. Every search/filter/sort/column/page-size/page change is read from and written straight to the signed-in administrator's saved preferences in the database, never to the URL: the address bar stays a clean `/admin/members` throughout, and only opening a specific member's detail panel adds the single short-lived `profileId` parameter. Validated preferences remain per administrator and per table across sessions and devices, restoring the exact page, filters, sort, and column layout the administrator left off on. Country and federation filter choices reuse the profile country's display names and ISO codes, and region choices reuse the profile's IDOC regions. The server applies the selected filter values and ordered sort clauses. Sort and View list fields alphabetically by default; Sort offers only visible fields and its own popover supports adding, editing, reordering, and removing custom multi-column sort clauses. View checkboxes control visibility and each row's drag handle reorders columns left-to-right, saved with each administrator's preferences. Country cells show names, membership type and status use uppercase labels and icons, and the expiration date matches other table dates. In the Member Name column, a gold shield marks an account with an active Super Admin grant and a gold user-cog marks an account with an active Administrator grant; revoked grants do not produce an icon. The filtered export icon sits at the right edge with a Download These results tooltip, immediately after View at the toolbar's far right, separated from the filters. Reset appears only once a facet or the expiration range is actually set; typing in search alone does not surface it, since the search field carries its own clear control. While a search, filter, sort, page-size, page, or column-visibility change is being applied, the table body shows real skeleton placeholder rows (matching the current column and row count) instead of dimming the outgoing rows' opacity, so the loading state reads as loading rather than as fainter text. Empty, loading, and error states remain explicit, while row links retain the established audited member-detail workflows.

Preferences follow the signed-in administrator across browsers and devices for the five named table identifiers, and are the sole source of truth for filters, sort, columns, page size, and page -- there is no URL-based override for any of it. The `DELETE /api/admin/table-preferences/[table]` endpoint still removes a table's saved preference row without changing records or another administrator's settings, but no toolbar exposes it as a button; every table's toolbar now offers only the single **Reset** control, which clears the table's active filters. If saving preferences fails, the current view remains usable and the administrator may retry the action. News, Seminars, and Content Pages now use the same Dice UI table composition and server-backed filtering, sorting, page size, and pagination. Their selected-row CSV export contains only the already-loaded page rows; their direct row links open the established edit, preview, or registration workflow. Membership selection also exports selected visible-page rows through the audited server endpoint, while Support selection can copy conversation links. Notification history and reconciliation findings have read-only Dice UI tables with local controls and server-authorized, audited selected-row exports that omit internal database identifiers. Their local view state does not persist. Publishing, deletion, refunds, account-state changes, and support replies remain in their existing individually authorized workflows.

The administrator layout no longer caps the table area at a fixed maximum width; the roster, News/Blog, Seminars, Pages, Support Inbox, and Stripe reconciliation tables stretch to the available viewport width (minus the sidebar and page padding) instead of rendering in a narrow column with unused space, so a wide table still scrolls horizontally only when its own columns need more room than the viewport provides. The Notifications read-only table is the one exception: it now lives inside the Members Sheet's Notifications tab (a member-scoped view, not a standalone page), so it is bounded by the Sheet's width rather than the full viewport. All administrator data tables share a visibly rounded corner treatment (search field, filter buttons, filter popovers, pagination controls, and the selected-row `ActionBar`'s buttons) distinct from the sharper corners used elsewhere in the product, and each multi-select or date-range filter trigger shows a dashed border to distinguish it from an ordinary button. Multi-select facet filter popovers expand to fit their longest option label so administrators can read the full text; on narrow screens, the popover stays within the viewport and labels wrap. Every table's header row uses the same slightly raised surface color as the toolbar's filter/sort/view buttons, reading as a distinct band above the body rows. Dismissing the selected-row `ActionBar` with its close icon only hides the bar; it never clears the underlying row selection, which only "Clear selection" (or an explicit new selection reaching zero and back up) does.

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

### Seminar completion deployment note (September 2026)

Migration `0059_seminar_guest_contact_fields.sql` is an expand-only migration adding structured guest first name, last name, and phone while retaining `guest_name` for production compatibility. Apply it before deploying this revision. Migration `0061` converts seminars to date-only events and adds language, canonical organizing National Federation, and structured rich-text information. Rehearse its content backfill and contract changes before applying it to the shared staging/production database.

Seminar cancellation is a financial orchestration, not merely a status edit. It cancels active seats, expires open Stripe Checkout Sessions after releasing database locks, automatically fully refunds confirmed Stripe payments through the durable refund ledger, and leaves failed refunds canceled plus `refund_failed` for administrator retry. Pending and manually paid offline records retain their truthful history and require the applicable operational follow-up rather than fabricated Stripe evidence. Operators must inspect reconciliation findings after provider/network failures and may use the existing registration refund retry control.


### Server Action observability
Unexpected exceptions caught by admin Server Actions that are converted into safe user-facing messages must be explicitly captured in Sentry. Runtime logs must not serialize raw database exceptions or other objects that can contain member, guest, payment, or other sensitive data.


### Seminar administration form behavior
Seminar create and edit actions open in the shared admin modal drawer rather than replacing the administration list page visually. The drawer is full width on small screens and approximately 85% of the viewport on desktop, traps keyboard focus while open, closes with Escape, overlay click, or the close control, and returns to `/admin/seminars` when dismissed.

### Seminar administration form layout
The seminar create/edit drawer uses a two-column desktop layout: Core Information occupies the left column, while Status, Schedule, and Pricing are stacked vertically in the right column so Schedule and Pricing fill the space immediately beneath Status. On smaller screens the sections stack responsively.

**Seminar registration confirmation email contract (September 2026):** every registrant receives one seminar registration confirmation using the shared IDOC midnight-navy/gold transactional shell and email-safe PNG logo. Its detail block follows the public seminar detail page order and icon concepts. Payment-specific copy belongs in the opening confirmation area before seminar details: bank transfer includes the current Organization Settings instructions, cash reminds the registrant to bring cash, and Stripe wording must never claim payment was received before the successful Checkout webhook. A separate registrant-facing payment-confirmed email is not sent.


## Admin table presentation defaults

Admin record text is display-only; opening or editing a record is done from the Actions column rather than by linking ordinary column text to edit/detail forms. Email addresses may remain `mailto:` links because they are communication actions, not record-edit shortcuts.

Column order is persisted per administrator and table. A saved administrator order always wins. Only when no saved `columnOrder` exists, use these defaults:
- Members: Name, Status, Membership Type, Expiration, IDOC Region, then remaining optional columns.
- Seminars: Title, Status, Prices, Start, End, Deadline, Registered / Capacity.
- Registrations: Registered, Registrant, Seminar, Payment Status.
- Support: Activity Date, Assigned, Category, Subject, Member, Status.

Seminar registration payment methods use the shared gold-branded icon mapping: card for Online / Stripe, bank for Bank Transfer, and cash for Cash at the Event. The registration search field is labeled simply “Search name or email”.

All administrator date-range filters must permit selecting dates at least three calendar years into the future. This applies to the Members expiration filter and every shared admin date-range/table date filter, because memberships, seminars, publication schedules, registrations, and other administrator records may legitimately be future-dated.

Meaningful icons shown anywhere in the application must expose a hover tooltip unless that icon already has an explicit tooltip. In the Members roster, the gold role icons immediately after a member name must identify Super Admin, Administrator, and Board Member individually; when more than one role applies, each icon keeps its own tooltip. Shared icon fallback logic may use an icon's explicit domain label, its associated interactive control's label, or its Lucide icon name, but it must not inherit labels from unrelated structural containers such as navigation regions. Custom SVG icons must provide their own domain label.


### Inline row editing feedback

News/Blog **Status** and **Access**, plus Seminar **Status**, are editable directly in their administrator tables. Changing one immediately displays a small gold loading spinner within that row's edited field and temporarily disables that field. The spinner remains visible during the protected server mutation and subsequent table refresh, until refreshed server data confirms the selected value. If the change fails, restore the preceding selection, clear the spinner and show the error. Inline status selectors intentionally hide the global native-select chevron so it cannot overlap status text; ordinary form selects retain their regular chevron. Do not replace this with a full-table skeleton for a single-row edit.

## News/Blog administration and media

News and Blog are one durable article system with an explicit `article_type` of `news` or `blog`. Existing articles default to NEWS unless migration 0064 identifies a legacy President's Blog item. The admin table displays the title with the slug beneath it; article subtitles remain part of the article record and edit form but are intentionally omitted from the administrator table to keep rows compact. ARTICLE TYPE and STATUS are icon-backed uppercase values, ACCESS uses a compact column whose audience badges stack vertically, and Publication Date is `dd/mm/yyyy`; both ARTICLE TYPE and STATUS are filterable and table preferences remain per administrator. STATUS and ACCESS are editable inline in each row without opening the article drawer. Inline Access preserves the same exclusivity rules as the form: Public and All logged-in Members stand alone, while Judge, Steward, and Veterinarian may be combined. The News/Blog table must fit its available desktop width without horizontal scrolling: selection, ARTICLE TYPE, STATUS, ACCESS, date, updated, and Actions use compact deliberate widths, while Title receives the remaining width and wraps only when its article metadata is unusually long.

The authoring form requires a NEWS/BLOG choice and accepts an optional JPG, PNG, WEBP, or AVIF thumbnail up to 5 MB. Thumbnail files are uploaded server-side to the IDOC Cloudinary account and only the durable HTTPS URL is persisted. The same server-side Cloudinary uploader powers the **Insert image** control in every administrator Tiptap field, which stores uploaded rich-content images under `idoc/rich-content`.

Runtime upload requires all three Cloudinary variables in Vercel: `CLOUDINARY_CLOUD_NAME=z6xv27qx`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. The API key and API secret come from the IDOC Cloudinary product environment's API Keys page. The key is an identifier but the API secret is sensitive and must be stored as a Vercel Sensitive value; neither belongs in source control. Configure the variables for the staging branch Preview environment before testing `staging.idoc.club`, and configure Production separately before launch. After adding or changing them, redeploy the affected environment because existing deployments do not receive newly added values retroactively. A missing key or secret intentionally causes uploads to fail with **Image upload is not configured** instead of silently dropping media.

Public `/news` and `/blog` listings are type-filtered server-side, include the thumbnail, and route to type-specific detail pages; the homepage uses the same typed database records rather than the legacy static President's Blog array.


### News/Blog pre-0064 rollout compatibility

If application code containing the News/Blog type and thumbnail features is deployed before database migration `0064_news_article_type.sql` reaches the shared Render database, read paths remain available in a temporary compatibility mode. In that mode, `/admin/news`, `/news`, `/blog`, homepage article cards, and article detail pages synthesize the known legacy NEWS/BLOG classification and legacy Cloudinary thumbnail URLs instead of querying the missing `article_type` and `thumbnail_url` columns.

This mode is read-compatible and now also self-heals the additive News/Blog schema on the first authorized administrator write. Before any thumbnail upload or article mutation, the server acquires a PostgreSQL advisory transaction lock and creates the missing 0064/0065 News columns, index, and checks idempotently. If the database user cannot perform that DDL, the save fails clearly and no upload/mutation proceeds.

The normal migration runner must still record migrations 0064 and 0065 afterward. Both migration files are idempotent so they can run safely after the write-path repair has already created the additive objects. Migration `0067_news_legacy_thumbnail_backfill.sql` is a separate idempotent data backfill for environments where migration 0064 had already been recorded before the legacy thumbnail assignments were added to that file. It populates only currently-null legacy thumbnail rows, so it does not overwrite administrator replacements. Verify the new columns and the `idoc.__drizzle_migrations` ledger, then retest `/admin/news`, `/news`, and `/blog`.


### External News/Blog link items

A News or Blog record may optionally point to an external `http://` or `https://` URL instead of an IDOC detail page. The administrator form exposes an **External link** field. When populated, public homepage/listing cards open that URL in a new tab with `noopener noreferrer`; when blank, cards continue to use the normal internal `/news/[slug]` or `/blog/[slug]` route. External-link records may consist only of title, optional subtitle/blurb, thumbnail, publication metadata, and the external URL; a rich-text body remains mandatory for internally hosted articles. Migration `0065_news_external_links.sql` adds the nullable URL and database constraints, and writes are blocked until that migration is present.

The former **Pages** administration surface is retired completely: it has no admin navigation item, routes, actions, editor/form, preview, table configuration, or administrator preference type. Existing persisted CMS pages remain read-only and can still be delivered through the public/member page renderer.

Selected-row **Delete selected** is available for Members, News/Blog, Seminars, Registrations, and Support. Server-side safeguards are authoritative: News/Blog uses the existing draft/archived rule; Seminars must be Draft or Canceled with no registration history; Registrations must already be canceled and have no Stripe/payment/refund evidence; Support conversations must be closed; Members are permanently deleted with account-linked profile, payment, registration, profile-change and support records purged; immutable audit events remain with the actor reference cleared. Reconciliation and financial/audit report tables remain immutable evidence and do not expose destructive deletion.

CI trigger note: external-link support is covered by migration 0065 and the News/Blog regression suite.


### Shared light-blue secondary button style

Administrator table controls are the casing exception to the site's ordinary all-caps button treatment. Filter triggers, date filters, **Sort**, **View**, **Reset**, and buttons/select triggers inside their table popovers use normal **Title Case** text while retaining the same bold weight, pill radius, light-blue raised surface, and dotted-border treatment. Do not force administrator table-control labels to uppercase.



The canonical light-blue/secondary button treatment is the same surface used by administrator table filter controls: `var(--surface-raised)` background, standard input border, foreground text, and `var(--accent)` hover with the gold-tinted border. The reusable `.idoc-secondary-button` class and the shared Button `secondary` variant own this treatment. Admin table controls and seminar registration controls that use `data-idoc-table-control` share the same CSS declarations. Do not introduce one-off blue hex colors. Use `.idoc-secondary-button--dotted` only where a dotted border is explicitly required, such as the FEI Course Calendar control in the Seminars page header.


## Admin table and form interaction contract

Every administrator feature backed by a record table must follow the same interaction pattern as the Members editor. This is a permanent product requirement for existing and future functional areas.

- **Edit/create forms open in drawers over the table.** The row Edit action opens the record in the shared administrator drawer rather than navigating the administrator to a standalone edit page. Where a table also supports Create/New, that form uses the same drawer pattern.
- **Successful submit closes and refreshes.** A successful create/edit/workflow submission closes the controlled drawer immediately, returns to its associated table, and refreshes that table so updated rows, counts, filters, and status values are current. Validation/server errors remain in the drawer and do not close it. All forms inside a shared table-backed drawer use the same success callback; no form may leave a success message displayed in an open drawer.
- **Consistent sectioned layout.** Drawer forms use carded sections with small uppercase gold section headings, matching the Members form. Related fields are grouped semantically and sections may use responsive two-column grids to make good use of the drawer width. Dense forms must not fall back to one long unstructured vertical field list.
- **Field spacing is deliberate.** Labels use a consistent label-to-control gap; related fields sit together; unrelated controls do not touch; explanatory/help text is visually separated from both the label and control. Full-width fields are reserved for content that benefits from width (titles, URLs, rich text, long text areas); shorter paired fields share rows where logical.
- **Drawer width is standardized.** Table-backed admin drawers use the shared approximately 70vw / max-5xl working width on larger screens and full width on small screens.
- **No form-level quick links.** Edit drawers contain the record form and record-specific workflow controls only. Navigation shortcuts, export/download shortcuts, preview links, and other table-level actions belong in the table Actions column or surrounding admin page, not in a “Quick links/Quick actions” panel inside the form.
- **Workflow state belongs in the form.** If a record has an editable workflow state, expose it as a normal field/toggle in an appropriate form section. Support tickets therefore use a Closed toggle in the drawer; News/Blog status is part of the Publishing section rather than separate publish/archive shortcut forms.
- **Boolean admin fields use toggles.** Persisted boolean Yes/No fields in administrator forms use the shared toggle control rather than checkboxes or Yes/No selects. This includes member Technical Delegate and Board Member, Organization Settings Bank Transfer/Cash enablement, seminar FEI affiliation, and Support Closed. Multi-value checklist fields and mutually exclusive workflow/status radio groups are not booleans and keep their appropriate controls. In the member profile drawer, Judge and Steward official-status checklists each occupy a full row with choices flowing horizontally; Technical Delegate occupies its own full row immediately below the Judge-status checklist.
- **Bulk operations stay table-level.** Selection-based state changes belong in the table action bar and execute server-authorized, audited operations. Support provides Close selected; News/Blog provides Apply status to selected records; destructive deletion keeps its existing retention and MFA protections.
- **Legacy direct edit URLs are compatibility routes only.** They redirect back to the table-backed drawer experience rather than maintaining a second full-page editing UI.

Current table-backed admin implementations covered by this contract are Members, News/Blog, Seminars, Seminar Registrations, and Support. Read-only evidence/reporting tables such as reconciliation do not need an edit drawer because they expose no record form.

### Admin dashboard summary requirements

The main Admin Dashboard is an operational summary, not only a navigation landing page. It shows:
- the latest unresolved Support tickets assigned to the currently logged-in administrator;
- the latest current Stripe reconciliation findings requiring attention;
- a compact revenue overview for the default reporting period, by currency, including gross recorded revenue, Stripe revenue, manual revenue, and payment count;
- direct links from each summary area to the full corresponding admin surface.

### Export list presentation

The Exports page is a plain bullet list. Each export name is normal non-underlined text; a download icon immediately after the text is the download control. Do not append “CSV” to the visible export label merely because the downloaded file format is CSV.

The shared drawer contract is regression-tested alongside the administrator table and privileged bulk-action suites.


### Admin drawer lifecycle, action feedback, and heading hierarchy

These rules apply to every existing and future administrator table that has row actions or a record form:

- **Route-backed drawers must reopen reliably.** A drawer's presence in the route/query state is authoritative: when the record/query parameter is present, the drawer is open. Shared drawers must not rely on an uncontrolled `defaultOpen` state that can remain closed when React/Next.js reuses the component after a previous close.
- **Every internal table action shows loading feedback.** Clicking an internal row action (Edit, Payment, Support, Preview, Registrations, or another internal admin destination) must start the same transition used by the Members table and set the table's existing `loading` state, producing the pulsing row skeleton until navigation resolves. Modifier-click behavior remains native. Pure downloads and `mailto:` actions are excluded because they do not navigate/refetch the table.
- **Drawer/form titles match table-page headings.** The main record/drawer heading uses the same `text-3xl font-semibold text-gold` treatment as the corresponding administrator table-page heading. It is Title Case and uses the singular form of the table-page entity name (for example Members → Member, Seminars → Seminar, Registrations → Registration).
- **Form section headers follow the Members hierarchy.** Semantic card/section titles are `text-xs font-bold uppercase tracking-wider text-gold`. All admin forms use the shared section treatment rather than hand-styled white/gold headings of different sizes.
- **Field labels are not section headers.** Individual field labels and legends use the normal foreground label treatment, display in Title Case throughout administrator forms, and should not be promoted to gold section-heading styling. Shared form sections provide deliberate vertical separation between adjacent field groups and wider gaps between direct side-by-side field groups.

The actionable admin tables currently covered are Members, News/Blog, Seminars, Seminar Registrations, and Support. Read-only tables with no row navigation have no skeleton-triggering row action to implement.

## Member communications and billing launch hold

The server-only `DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING` setting defaults to blocking. Only exact `false` releases member communications and live application billing; validated Stripe test-mode mutations remain available. Configure staging and Production independently. Follow [the complete launch-hold runbook](27-member-communications-and-billing-launch-hold.md) for coverage, terminal queue handling, webhook reconciliation, pre-launch verification, release and emergency re-hold.

## PostgreSQL connection capacity on Vercel

The shared Drizzle/Postgres.js client in `lib/db/drizzle.ts` is used by both SQL templates and ORM queries. Each active Vercel instance now caps its direct PostgreSQL pool to two connections, closes idle connections after 20 seconds, rotates connections after five minutes, and uses a 10-second connection-establishment timeout. Connections carry the PostgreSQL `application_name=idoc-club` label for attribution in Render logs and `pg_stat_activity`. No new environment variables are required.

These are per-instance limits, **not** a global concurrency limit: preview deployments and Vercel cron invocations may each allocate their own pool. The application has scheduled cron jobs even when no one is browsing staging. Check total connections by `application_name` and source address before attributing them to one app. This change limits connection pressure but does not replace an adequate database memory allocation, Render incident analysis, or a global external connection pool.

Render incidents on October 6 and 8, 2026 showed recurring unclean PostgreSQL shutdowns and recovery coinciding with Vercel `CONNECTION_CLOSED` errors. The shared Render database was on a 256 MB plan, with 100 configured max connections and approximately 72 active connections near one shutdown. Render metrics showed memory close to the 256 MB limit. Host-level out-of-memory termination remains to be confirmed by Render Support. Do not blindly retry non-idempotent writes after a lost connection because their commit status may be unknown.


## Event-triggered account email delivery

Password reset and migration activation links are inserted into their durable outbox in the same database transaction as their token. Immediately after commit, a Next.js `after()` callback attempts delivery outside the request response critical path. Security notices and operational alerts similarly trigger their existing leased workers after their outbox insert commits. Six-digit signup, sign-in, and password-reset verification codes continue to be delivered synchronously because they are short-lived.

The account-delivery cron runs every 15 minutes as a **durability and retry safety net** rather than polling every five minutes. It also continues to process Stripe customer-email synchronization. Workers preserve claim leases, deduplication, retry/backoff, communication holds, and dead-lettering. A Vercel function termination or provider failure before/while an after-response callback executes can delay delivery until the next 15-minute sweep; do not claim unconditional instant email delivery. The schedule is UTC. No new environment variables are required.

Diagnose delayed messages by checking the applicable outbox row's availability time, lease, attempt count and error code, then review Sentry for worker exceptions. Do not bypass the communication-and-billing launch hold in staging or during legacy member import.


## Seminar cancellations and date-only news publishing

When an administrator cancels a seminar in the form or via inline Status editing, the status change and registration cancellation commit together. The application immediately dispatches the existing cancellation resolution worker after the response, so online payments are refunded or outstanding Checkout Sessions expired promptly. The hourly cancellation cron is retained as a durable recovery sweep for provider failures, interrupted requests, or any canceled registration not processed in the first batch. The existing billing/communication hold remains enforced by the worker.

The News/Blog admin form accepts a publication **calendar date only** (YYYY-MM-DD). Publication dates are normalized to 00:00 UTC. The scheduled-publishing cron runs daily at 00:00 UTC; it publishes due articles and logs the transition. The admin News/Blog table shows only the calendar date. No timezone or time-of-day selection is exposed. The daily publishing job may run shortly after midnight depending on scheduler execution timing. Existing historical timestamps remain in storage; editing an article converts its publication date to midnight UTC.


## QStash event-driven job migration (staging cutover)

QStash executes event-triggered account email and seminar cancellation workers, and can execute all recurring tasks instead of Vercel Cron. This reduces idle database polling, useful for Neon scale-to-zero. **The Vercel schedules intentionally remain active until QStash is configured, its signed endpoint is verified, and all replacement schedules are registered and observed working.** Do not remove both scheduling paths at once. The database outboxes remain authoritative, and repeated callbacks are protected by the existing worker leases/idempotency. Keep staging separate from production.

### Required Vercel environment variables

Set the following on the **staging** deployment (and only later set independent production values):
- `QSTASH_TOKEN`: QStash publishing API token from the selected Upstash region.
- `QSTASH_CURRENT_SIGNING_KEY`: current key from QStash security settings.
- `QSTASH_NEXT_SIGNING_KEY`: next key, required to permit signing-key rotation.
- `QSTASH_URL`: QStash API origin for the selected region, e.g. `https://qstash-us-east-1.upstash.io`. Omitting it defaults to the global QStash API.
- `QSTASH_CALLBACK_BASE_URL`: stable **public staging** URL, e.g. `https://staging.idoc.club`. Never set this to a dynamic preview deployment, localhost, or a production hostname while testing staging.

No database migration is required. Existing `CRON_SECRET` remains mandatory for internal worker reuse, including the verified QStash callback.

### Verification and cutover

1. Provision a QStash resource in Upstash, with separate staging and production resources/credentials. Add variables to Vercel staging, then redeploy staging. Ensure the public callback path `/api/qstash/jobs` is accessible to Upstash and not blocked by Vercel Deployment Protection (the endpoint itself verifies the `Upstash-Signature` JWT and raw-body hash).
2. Run `node scripts/configure-qstash-schedules.mjs` from a trusted local/CI shell with `QSTASH_TOKEN`, `QSTASH_CALLBACK_BASE_URL`, and optionally `QSTASH_URL`. The script uses stable schedule IDs and can be rerun without multiplying schedules. Inspect all ten schedules in Upstash Console.
3. Confirm forged/unsigned callbacks get HTTP 401, valid callbacks execute once, deliberate Brevo failure produces an on-demand retry, and cancellation/refund tasks are processed without duplicated refunds. Confirm the communication/billing launch hold remains in effect for staging imports.
4. After verified QStash triggers and schedules, remove all eight Vercel Cron entries from `vercel.json` in this **same PR** and update the contract tests. Do not deactivate Vercel scheduling before this verification, or there will be a delivery gap. Monitor Sentry and QStash failures after deployment.
5. Keep the daily QStash account and cancellation safety sweeps to recover work committed in Postgres but not successfully published to QStash. Expired account links are ineligible and must never be sent late.

The QStash schedule catalog is in `lib/background/qstash.ts`: account recovery daily 09:00 UTC, cancellation recovery daily 09:05 UTC, clock skew daily 09:10 UTC, renewal scan daily 06:00 UTC, renewal delivery daily 06:15, 14:15 and 22:15 UTC, reconciliation daily 07:00 UTC, retention daily 08:00 UTC and news publishing daily 00:00 UTC. QStash itself doesn't keep Postgres awake; each actual callback will briefly wake Neon if needed.


## New Relic observability and deployment change tracking

**Scope.** IDOC Next.js runs on Vercel; logs and Vercel-generated spans stream to the US New Relic account (account ID `8600002`). The Vercel project ID for IDOC is `prj_OQ45skGMvZt6XB0ieDfsyqyp7Sb4`. The Render PostgreSQL instance is **shared by multiple applications**; do not treat all Render database logs as IDOC-only telemetry. Sentry remains the application error-monitoring system. Neither these integrations nor the GitHub workflow affect the still-live WordPress site at `idoc.club`.

### Provisioning and credentials

1. In Vercel **Team Settings → Drains**, verify that `New Relic` (logs) and `New Relic — Traces` are enabled for the intended projects and deployment environments. The trace drain sends OTLP HTTP Protobuf to `https://otlp.nr-data.net/v1/traces` using a confidential New Relic **license / ingest key** in the `api-key` HTTP header. The log drain sends to New Relic's US log intake. Do not commit, print, or log either ingest credential.
2. In GitHub **Repository Settings → Secrets and variables → Actions**, create repository secret `NEW_RELIC_API_KEY` with a New Relic **user API key** permitted to create change-tracking events in US account `8600002`. This is **not** the Vercel ingest/license key. The workflow uses the existing secret; it does not require `NEW_RELIC_DEPLOYMENT_ENTITY_GUID`.
3. New Relic must have an **application-specific** service entity named `idoc.club` before the workflow can record change events against it. Its `entitySearch` intentionally uses `name = 'idoc.club' AND type = 'SERVICE'`; verify this selects exactly one IDOC entity in the correct account before enabling production tracking. The Vercel-generated entities named `vercel.serverless-runtime` and `vercel.edge-network` are *shared* and must never be used as the IDOC deployment target. Vercel trace delivery alone **does not create** a dedicated IDOC service. Application instrumentation uses `@vercel/otel` with `registerOTel({ serviceName: 'idoc.club' })` in the root `instrumentation.ts`. Sentry remains enabled for errors with `skipOpenTelemetrySetup: true` to avoid competing tracing providers. The existing Vercel team trace drain exports the new application spans, so no additional Vercel or GitHub secrets are needed for OpenTelemetry. Confirm the dedicated entity is created from real staging traffic before treating change tracking as complete.
4. A Vercel deployment normally emits GitHub `deployment_status` events. The workflow responds only to `success` for `Production` or `Preview`; check the exact environment labels actually produced by Vercel. The workflow targets the GitHub repository itself and does not mark unrelated Vercel projects.

### Validation

- In New Relic **Query your data / NRQL**, verify IDOC trace attribution without confusing it with all Vercel traces:
  ```sql
  SELECT count(*) FROM Span
  WHERE `vercel.projectId` = 'prj_OQ45skGMvZt6XB0ieDfsyqyp7Sb4'
  SINCE 1 hour ago
  ```
- Check `SELECT count(*) FROM Span FACET `service.name` SINCE 1 hour ago` to confirm whether a dedicated IDOC service is emitting spans. A nonzero first query plus only `vercel.serverless-runtime` does **not** meet this prerequisite.
- After provisioning the dedicated entity, confirm the `entitySearch` query matches **only** IDOC. Deploy to **staging** first; confirm that GitHub Actions shows `New Relic IDOC deployment tracking` completing successfully for an actual Vercel `deployment_status: success` event, and that the event is visible in New Relic Change Tracking attached to IDOC. Verify `version`, commit, deep link, and environment, and that unrelated projects receive no event.
- Never interpret passing PR CI alone as deployment/change-tracking verification: the workflow is deployment-status-triggered, not PR-triggered. Do not merge or enable it as complete when the dedicated service is still absent.

### Rotation and troubleshooting

- To rotate `NEW_RELIC_API_KEY`, issue a new **user API key** in the correct New Relic account, update the GitHub Actions repository secret, test one deployment event, then revoke the old key. Never place API keys in GitHub variables or workflow YAML.
- Rotate the **license / ingest key** independently: create a new ingest key, change the Vercel trace drain `api-key` header (and any log drain destination credentials as applicable), test destination acceptance and real spans/logs, then revoke the previous ingest key.
- No GitHub workflow run after deployment? Check whether Vercel created a GitHub deployment status and whether the reported environment exactly matches `Production` or `Preview`. A successful git push or successful PR check is not a deployment-status event.
- Workflow fails with unauthorized errors? Verify a user API key (not a license key), New Relic US account, and secret availability. Entity search has no match or matches several? Verify the IDOC-specific service/entity creation and exact name. If the deployment marker is missing, inspect the action log and New Relic Change Tracking rather than inferring success from a test HTTP response.
- No spans? Review Vercel trace-drain delivery, sampling, project and environment selection, real application traffic, OTLP endpoint, ingest key, and New Relic query time range. Shared Vercel spans may still arrive while IDOC application-specific instrumentation is absent.
