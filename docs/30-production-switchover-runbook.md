# 30. Production switchover runbook (WordPress to idoc.club)

Single linear checklist for the day production replaces the WordPress site on `idoc.club`. Reference detail lives in docs/03 (import), docs/04 (Stripe and reconciliation), docs/07 (environments and env vars). Do the steps in order; do not skip ahead. Super Admin only.

## A. Before the day (nothing here is visible to members)

1. Production code and migrations are current: the Auto-migrate Production Schema run for the latest promotion is approved and green, and the production migration ledger matches staging.
2. Clean production test data (test users, profiles and subscriptions created while testing) so the import starts from an empty member set.
3. Vercel: `idoc.club` and `www.idoc.club` are added to the production project (DNS not yet pointing at Vercel).
4. GoDaddy: lower the TTL of the `idoc.club` A and `www` records as far as GoDaddy allows (600 s today).
5. Stripe: the live webhook endpoint for the production site exists and is listed with the handled event types; keep it disabled until step B5. Staging keeps a test-mode key.
6. Google OAuth redirect URI and Turnstile hostname already include `idoc.club`.
7. Dry-run the importer on staging with a fresh export to confirm nothing needs a decision.

## B. Switchover day, in this order

1. **Freeze WordPress.** Enable the maintenance message on the old site so no one signs up or pays between the export and the DNS change.
2. **Export.** In phpMyAdmin export the WordPress users tables and the MemberPress tables as SQL. Note the UTC time of the export; it is the "since" time for event replay.
3. **Switch production to the domain.** Set `BASE_URL`, `GOOGLE_OAUTH_REDIRECT_URI` and `QSTASH_CALLBACK_BASE_URL` to `https://idoc.club` (production scope), confirm production already holds the live-mode `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (from the live webhook endpoint) and live membership Product/Price values (the runtime rejects a test key once the base URL is `https://idoc.club`; staging must keep its own test values), set `LEGACY_IMPORT_ENABLED=true` and a temporary restricted read-only `LEGACY_STRIPE_SECRET_KEY` (production scope), and redeploy production.
4. **DNS.** At GoDaddy point the apex A records and the `www` CNAME to the values Vercel shows for the project. Wait until Vercel shows both domains as valid and `https://idoc.club` serves the new site.
5. **Enable the live webhook endpoint** in Stripe. Events delivered from now on are consumed by the launch hold (recorded, not applied); they are replayed in step B8.
6. **Import.** `/admin/operations/legacy-import`: run the dry run with the new dumps, resolve or accept every item under "Needs a decision", then import (typed confirmation and backup confirmation required).
7. **Check the admin.** Spot-check members, payments, subscriptions and the member count against the dry run.
8. **Release the launch hold.** First complete items 4 and 5 of the pre-launch checklist in docs/27: inspect hold logs and outbox markers, inventory and suppress stale pending jobs with the reviewed SQL there, and review webhook findings and canceled seminar registrations, because releasing the hold lets the workers resume anything still queued. Then set `DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING` to exactly `false` (production only; staging stays `true`) and redeploy.
9. **Replay missed Stripe events.** `/admin/operations/event-replay`: enter the export time as "since", preview, check the counts, apply. This recovers payments and renewals that happened after the export.
10. **Reconciliation.** `/admin/reconciliation`: run a scan and work the findings. Stripe-changing actions stay simulated until `RECONCILIATION_LIVE_STRIPE_ACTIONS=enabled` is set; set it only after the import and replay are verified.
11. **Clean up.** Remove `LEGACY_STRIPE_SECRET_KEY` and `LEGACY_IMPORT_ENABLED`, redeploy production (the running deployment keeps the old values until then), and revoke the restricted key in Stripe (procedure in docs/07, legacy import section). Confirm the scheduled reconciliation scan emails Super Admins.
12. **Final verification.** Reload `/admin/operations/switchover` and read the Final verification section; every line should be Ready, or a Check you have consciously accepted.

## C. Rollback points

- Before step B4: undo B3 env values; WordPress is untouched.
- After B4: point DNS back at WordPress (TTL bounds the delay). Members created on the new site in the interim would need a manual export.
- After B6: the import is all-or-nothing; a failed import writes nothing. A completed import cannot be re-run as a delta (already-imported members are skipped).

**Status page.** `/admin/operations/switchover` (Super Admin only, read-only) shows the state of everything above for the environment you are viewing: migrations applied, test data present, Stripe key mode, webhook endpoint (enabled, all handled event types), the three domain settings, the import switch and key, the launch hold and the live-actions safeguard. Below it, a Final verification section is the last step (B12): run it after the import, replay and first scan; it reports the import and member counts, the import switch and key, the launch hold, Stripe live mode and webhook traffic, events still waiting for replay, the replay and scan records, open reconciliation findings, the live-actions switch and failed queue jobs. Settings are read by presence and domain only, never value. Reload it after each step; settings change only after a redeploy.
