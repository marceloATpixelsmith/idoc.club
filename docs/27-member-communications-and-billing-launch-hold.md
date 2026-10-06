# Member communications and billing launch hold

`DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING` is a server-only deployment setting that prevents accidental communications and live billing during migration, verification, or an incident. Only the exact string `false` releases it. `true`, missing, empty, whitespace-padded values, uppercase values, and every other invalid value hold it closed. It is never a `NEXT_PUBLIC_` variable and is never serialized to a browser. A build does not require this variable or provider credentials.

## Configure each deployment

In Vercel Project Settings → Environment Variables, configure the name separately for **Production** and **Preview scoped to the `staging` branch**. Set both to `true` throughout migration and verification, then redeploy both branches. Do not configure an unscoped Preview `false`: unrelated previews must remain held. The value differs by deployment even though staging and production deliberately share PostgreSQL. Changing environment settings affects a new deployment; it does not change an already-running instance. Confirm the new deployment is serving the intended domain and retire older instances before judging the hold effective.

A validated Stripe **test** key still permits sandbox Stripe mutations under the hold. This exemption never permits email delivery. Key shape and deployment mode must pass the existing Stripe configuration validator; missing or invalid keys cannot claim the sandbox exemption. A verified webhook with `livemode: true` is held regardless of a configured test key. Do not use live keys for staging acceptance.

## Covered boundaries and results

| Boundary | Held behavior |
|---|---|
| Brevo transactional sender | Throws `MemberLaunchHoldError`, code `member_launch_hold`, before configuration lookup or provider HTTP. Covers membership, renewal, payment, activation/reset, email verification and OTP, security/account notifications, seminar member/guest confirmations and refunds, admin previews, contact form and operational alerts. |
| Mailchimp audience subscribe/unsubscribe | Returns `{ status: 'blocked' }` before HTTP, leaving the committed profile/entitlement operation intact. Audience automation can itself send mail, so it is held too. |
| Membership and seminar/guest Checkout, renewal Setup Checkout, Customer creation, card-update portal | Live actions throw the same safe hold error before action/provider writes; existing payable Checkout URLs are not returned by a held live action. |
| Subscription cancellation/update, schedule create/cancel, Checkout expiry, Prices/Products, refunds, Customer email synchronization | Live mutations are blocked at both action and shared SDK boundaries. Sandbox billing retains the existing rules. |
| Renewal scans | Returns numeric `blocked: 1`, queues no renewal/expiration/grace reminders. Existing local entitlement/grace expiry transitions continue; any resulting notice is terminally suppressed. |
| Account, security, operational-alert, renewal, staging seminar-confirmation, profile-change and live Customer-sync workers | Returns `status: 'blocked'` / batch `blocked: 1` before claiming rows, decrypting payloads, or consuming retries. A held staging worker does not mark production's shared jobs dead-lettered. |
| Seminar cancellation-resolution cron | Returns `blocked: 1, processed: 0` before querying/provider work in live mode; creates no retry/failure findings while held. Its existing intentional refund/Checkout-expiry resolution resumes after release, so review canceled paid registrations before launch. |
| Verified Stripe webhooks | Signature verification, deduplication, provider-confirmed accounting, entitlement and reconciliation remain active. Prohibited outgoing email is suppressed. Prohibited mutations (renewal schedule authorization, refund-driven cancellation, automatic seminar/guest refunds) create a reconciliation finding and return `status: 'blocked'`; the event is consumed and acknowledged with HTTP 200 to prevent delivery storms. Other failures retain their existing rollback/retry behavior. |
| Admin/member cancellation and suspension | Local entitlement changes retain their existing semantics. A prohibited Stripe cancellation reports `stripeCancelled: false` and a safe `stripeCancelError`; this must be reconciled and must not be treated as cancellation of provider billing. |

No email exemption is provided: a configurable administrative recipient can also be a member. Operational evidence remains in logs, audit records and reconciliation findings; the hold also blocks operational email, contact mail and admin preview mail. Direct send callers retain their existing safe failure statuses (`delivery_failed`, `delivered: false`, or their existing user-safe error); anonymous recovery responses remain enumeration-neutral. Best-effort notices never change a successfully recorded payment into a failed payment merely because its email is held.

Read-only Stripe retrieval/list/search/reconciliation, webhook verification, legacy data import/transformation, CMS content, local account/profile/security changes, entitlement corrections and manual payment records remain available subject to their existing authorization. Import must preserve verified external references and paid-through dates, never invoke purchase APIs, create subscriptions/schedules/charges or send activation mail as an import side effect. The available executable content import has no provider calls. This branch has no executable bulk member importer: its documented member mapping and reconciliation process needs operator-supplied, protected inputs and separate verification.

## Queues, release and reconciliation

Every application outbox producer records communications created while held as `dead_lettered_at` plus `last_error_code='member_launch_hold'`, without incrementing attempts or setting `sent_at`. Live Customer-sync jobs follow the billing mode; sandbox sync remains usable. Suppressed rows are not released when the variable becomes `false`. Do not clear their dead-letter flags in bulk. Review the current state, eligibility and token expiry before an intentional new member request or an individually authorized new job. Renewal scans resume their existing current-date windows, not historical replay.

Jobs created **before** the hold keep their existing state because the queues are shared across deployments. They are not claimed by a held worker. Before release, operators must inventory and reconcile this older pending work; otherwise the existing released worker will resume its ordinary eligible jobs. While both deployments remain held, permanently suppress stale work using the reviewed SQL below. This is an explicit operator action, never an automatic staging cleanup. Review counts first, retain an audit/change record, and use a transaction in the approved database console. Do not reset `sent_at`, deduplication identities, attempts, or provider idempotency keys.

```sql
BEGIN;
-- Review these counts and eligibility before deciding to suppress pending work.
SELECT 'account' AS queue, count(*) FROM idoc.account_delivery_outbox WHERE sent_at IS NULL AND dead_lettered_at IS NULL AND terminal_at IS NULL
UNION ALL SELECT 'security', count(*) FROM idoc.auth_security_notification_outbox WHERE sent_at IS NULL AND dead_lettered_at IS NULL
UNION ALL SELECT 'notifications', count(*) FROM idoc.notification_outbox WHERE sent_at IS NULL AND dead_lettered_at IS NULL
UNION ALL SELECT 'operational', count(*) FROM idoc.operational_alert_outbox WHERE sent_at IS NULL AND dead_lettered_at IS NULL;
-- Run updates only after review while both deployments are held and older workers have stopped.
UPDATE idoc.account_delivery_outbox SET dead_lettered_at=now(), last_error_code='member_launch_hold', lease_owner=NULL, lease_expires_at=NULL WHERE sent_at IS NULL AND dead_lettered_at IS NULL AND terminal_at IS NULL;
UPDATE idoc.auth_security_notification_outbox SET dead_lettered_at=now(), last_error_code='member_launch_hold', lease_owner=NULL, lease_expires_at=NULL WHERE sent_at IS NULL AND dead_lettered_at IS NULL;
UPDATE idoc.notification_outbox SET dead_lettered_at=now(), last_error_code='member_launch_hold', lease_owner=NULL, lease_expires_at=NULL WHERE sent_at IS NULL AND dead_lettered_at IS NULL;
UPDATE idoc.operational_alert_outbox SET dead_lettered_at=now(), last_error_code='member_launch_hold', lease_owner=NULL, lease_expires_at=NULL WHERE sent_at IS NULL AND dead_lettered_at IS NULL;
COMMIT;
```

A blocked webhook mutation is not deferred or replayed automatically. The consumed event and `reconciliation_findings` identify the provider evidence requiring review. Renewal Setup becomes `failed`; cancellation, refund or schedule recovery requires an explicit authorized action and the existing idempotency policy. Always reconcile Stripe's actual state first. Retrying the same webhook ID after release remains a duplicate.

## Operator pre-launch checklist

1. Set the hold to `true` separately for staging and production; redeploy and verify both instances. Leave staging held after production release.
2. Back up the approved data store and retain immutable protected source exports. Complete the IDOC-only import and reconcile row counts, identities, external Customer/Subscription references, rolling paid-through dates and transformed professional/profile fields. Resolve missing/ambiguous fields without inventing data.
3. Resolve import defects before launch. The current full legacy content SQL has a pre-existing seminar INSERT column/value count defect; the news portion is executable and covered by the hold test, but the full content import is not currently a passing launch prerequisite. Do not call the member import verified merely because the content test passes.
4. Inspect hold logs, outbox terminal markers, reconciliation findings, Brevo delivery evidence and Stripe API/event evidence. Confirm that no prohibited outgoing email or live billing mutation occurred. Existing provider renewals, retries and previously issued payment links require independent review.
5. Review all older pending jobs and suppress stale work explicitly using the procedure above. Review webhook findings and canceled seminar registrations individually; the existing cancellation-resolution batch intentionally resumes eligible refunds/Checkout expiry after release. Confirm no old workers or held-production deployment can race release, and no queued work is unintentionally releasable.
6. Use isolated synthetic fixtures to test fail-closed parsing, held sends/scans, sandbox renewal, live-event rejection, accounting and webhook deduplication. `pnpm check`, `pnpm test:integration-db`, `pnpm test:build-boundary` and the security suite cover these boundaries. Ordinary staging keeps `true`; the isolated security browser suite deliberately uses `false` with intercepted providers. Real outbound email acceptance requires a separately isolated deployment/recipient policy and explicit release there, never shared-production staging mail.
7. After import/reconciliation, whole-product acceptance and queue review are signed off, explicitly set **Production only** to `false` and redeploy. Confirm the new production instance, release one intentional eligible action, and check provider/audit evidence. Keep the branch-scoped staging value `true`.
8. To reinstate the hold, set Production to `true` and redeploy immediately. Confirm old instances have stopped. Preserve incident evidence and repeat queue/provider reconciliation before any subsequent release.

## Limitations and developer contract

The switch blocks actions initiated by this application. It cannot pause existing Stripe subscriptions, Stripe Smart Retries, an already-issued Checkout/Portal link, in-flight requests, legacy WordPress mail/billing, or independently configured provider automation. Arrange those provider-side controls explicitly; changing the flag cannot reverse an already accepted send/charge. Staging and production share queues without complete deployment partitioning: even released production can process some unrelated staging rows. The terminal enqueue marker prevents newly held staging work from entering that backlog, but it does not solve the pre-existing cross-deployment design gap.

Use the small server-only `lib/runtime/member-launch-hold.ts` utility. Never compare the raw variable elsewhere. Provider mutations must use the shared guarded Stripe factory or an action guard; verified webhooks also apply their event's live-mode evidence. New senders, provider SDKs, queue producers and consumers must preserve these boundaries and extend the coverage tests. Do not bypass the hold for `NODE_ENV=test`; fixtures explicitly select their state. Blocked logs contain only fixed operation categories, never recipients, names, tokens, identifiers, payment details or provider response bodies.
