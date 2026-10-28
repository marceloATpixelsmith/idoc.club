# 30. Production switchover runbook (WordPress to idoc.club)

Single linear checklist for the day production replaces the WordPress site on `idoc.club`. Reference detail lives in docs/03 (import), docs/04 (Stripe and reconciliation), docs/07 (environments and env vars), docs/27 (launch hold). Do the steps in order; do not skip ahead. Super Admin only.

**The guided walkthrough.** `/admin/operations/switchover` (Super Admin only, read-only) presents exactly these steps, with the same numbers (A1 to A11, B1 to B13). It highlights the next step, shows the variables to change and the scope of each, and re-checks what the site can see after each step (migrations, test data, domain settings, Stripe key mode, webhook, import, hold, replay, scan, clean-up). Steps in Vercel, Stripe, Brevo, GoDaddy and WordPress are manual: the page cannot see them, so you tick them (ticks live in your browser only). It never changes anything and shows settings by presence and domain only, never values. Settings change only after a redeploy, so press Re-check after redeploying. Run it on the production site for the real answer.

## A. Before the day (nothing here is visible to members)

1. **A1** Production code and migrations are current: the protected Monitored staging to production promotion run is fully green (including its verified backup, production migration ledger, Vercel deployment and health check). The Auto-migrate Production Schema workflow is only for manual recovery. Follow docs/31 for the one-time workflow bootstrap.
2. **A2** Clean production test data (test users, profiles and subscriptions created while testing) so the import starts from an empty member set. Administrators stay.
3. **A3** Split the Stripe variables. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_MEMBERSHIP_PRODUCT_ID` can exist as one entry covering Production and Preview, so both share one value. Give Preview (the `staging` branch) its own test-mode values and Production its own entries. Do not deploy between removing Production from the old entry and adding the new Production-only one.
4. **A4** Create `BREVO_WEBHOOK_KEY` as a Production-only variable (a random value of 32 or more letters and numbers, for example `openssl rand -hex 32`). It is not issued by Brevo: the same value goes into the Brevo webhook URL in B5. It is visible to the site after the next production deployment.
5. **A5** Delete the `LEGACY_STRIPE_SECRET_KEY` entry that applies to every Preview branch; keep the one limited to the `staging` branch.
6. **A6** Promote seminars and News/Blog from staging to production with Data Promotion (docs/07, "Permanent staging-to-production data promotion"). One-time setup first: the database role `idoc_data_promoter`, and `DATA_PROMOTION_DATABASE_URL` and `DATA_PROMOTION_PLAN_SECRET` for the staging branch only, then redeploy staging.
7. **A7** `idoc.club` and `www.idoc.club` are listed on the production Vercel project (DNS not yet pointing at Vercel).
8. **A8** GoDaddy: lower the TTL of the `idoc.club` A records and the `www` CNAME as far as GoDaddy allows (600 s today).
9. **A9** Stripe: create the live-mode webhook endpoint for `https://idoc.club/api/stripe/webhook` with every handled event type, and copy its signing secret for B3. Keep it disabled until B8.
10. **A10** Google sign-in lists the `idoc.club` callback; Cloudflare Turnstile covers `idoc.club` (a domain covers its subdomains).
11. **A11** Dry-run the importer on staging with a fresh export to confirm nothing needs a decision.

## B. Switchover day, in this order

1. **B1 Freeze WordPress.** Enable the maintenance message on the old site so no one signs up or pays between the export and the DNS change.
2. **B2 Export.** In phpMyAdmin export the WordPress users tables and the MemberPress tables as SQL. Note the date and time you start the export, in your own local time; it is the start time for the event replay (the replay page takes local time and shows the UTC equivalent itself).
3. **B3 Switch production to the domain, live Stripe and the importer.** Change the Production variables in the table below and redeploy production once. The Stripe values must be the live ones: the runtime rejects a test key once the base URL is `https://idoc.club`.
4. **B4 DNS.** At GoDaddy point the apex A records and the `www` CNAME at the values Vercel shows. Wait until Vercel shows both domains as valid and `https://idoc.club` serves the new site. The wizard sees this step done when you load it from `idoc.club`.
5. **B5 Brevo webhook.** In Brevo, Plugins & Integrations, Webhooks, Outbound webhook, Add webhook: URL `https://idoc.club/api/brevo/webhook?key=` plus the `BREVO_WEBHOOK_KEY` value, authentication none, category Transactional email, events Hard bounce, Soft bounce and Complaint only. The site acts on those three and ignores the rest.
6. **B6 Import.** `/admin/operations/legacy-import`: run the dry run with the new dumps, resolve or accept every item under "Needs a decision", then import (typed confirmation and backup confirmation required).
7. **B7 Check the admin.** Spot-check members, payments, subscriptions and the member count against the dry run.
8. **B8 Enable the live Stripe webhook** endpoint, only now that the import is in and checked, with the launch hold still ON. Enabling it earlier would let a payment for a member who is not imported yet be received and discarded. Anything Stripe sent before this point is picked up by the replay in B10. Once the endpoint is on, a payment for an imported member is applied to the database immediately even with the hold on (the hold blocks emails and changes made in Stripe, not these records), so the replay count in B10 may be lower than the number of payments since the export. That is expected, not a missed payment.
9. **B9 Release the launch hold.** First complete items 4 and 5 of the pre-launch checklist in docs/27: inspect hold logs and outbox markers, inventory and suppress stale pending jobs with the reviewed SQL there, and review webhook findings and canceled seminar registrations, because releasing the hold lets the workers resume anything still queued. Then set `DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING` to exactly `false` (production only; staging stays `true`) and redeploy.
10. **B10 Replay missed Stripe events.** `/admin/operations/event-replay`: enter the export start time from B2, preview, check the counts, apply. The walkthrough counts B10 as done only when the replay was recorded after the import and no event failed; if any failed, preview again and re-apply to retry them.
11. **B11 Reconciliation.** `/admin/reconciliation`: run a scan and work the findings. The walkthrough counts B11 (and B13) as done only for a scan that ran after the successful replay, so rerun the scan if one happened to run before B10. Stripe-changing actions stay simulated until `RECONCILIATION_LIVE_STRIPE_ACTIONS=enabled` is set; set it only after the import and replay are verified.
12. **B12 Clean up.** Remove `LEGACY_STRIPE_SECRET_KEY` and `LEGACY_IMPORT_ENABLED`, redeploy production (the running deployment keeps the old values until then), and revoke the restricted key in Stripe (procedure in docs/07, legacy import section). Confirm the scheduled reconciliation scan emails Super Admins.
13. **B13 Final verification.** Reload the page and read the Final verification section; every line should be Ready, or a Check you have consciously accepted.

### Production variables that change on the day

| Step | Variable (Production scope) | Change |
|---|---|---|
| B3 | `BASE_URL` | `https://redesign.idoc.club` to `https://idoc.club` |
| B3 | `GOOGLE_OAUTH_REDIRECT_URI` | to `https://idoc.club/api/auth/google/callback` |
| B3 | `QSTASH_CALLBACK_BASE_URL` | to `https://idoc.club` |
| B3 | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MEMBERSHIP_PRODUCT_ID` | to the live-mode values |
| B3 | `LEGACY_IMPORT_ENABLED` | add, `true` |
| B3 | `LEGACY_STRIPE_SECRET_KEY` | add, the temporary restricted read-only live key |
| B9 | `DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING` | to exactly `false` (staging stays `true`) |
| B11 | `RECONCILIATION_LIVE_STRIPE_ACTIONS` | optional, later: add `enabled` |
| B12 | `LEGACY_IMPORT_ENABLED`, `LEGACY_STRIPE_SECRET_KEY` | delete both, redeploy, revoke the key in Stripe |

Staging variables do not change on the day. `DB_SCHEMA` and `POSTGRES_URL` never change.

## C. Rollback points

- Before step B4: undo B3 env values; WordPress is untouched.
- After B4: point DNS back at WordPress (TTL bounds the delay). Members created on the new site in the interim would need a manual export.
- After B6: the import is all-or-nothing; a failed import writes nothing. A completed import cannot be re-run as a delta (already-imported members are skipped).

## Legacy password compliance first-login verification

A member whose imported WordPress credential verifies successfully but fails any current IDOC password requirement (10–128 Unicode code points, uppercase, lowercase, numeral, special character) cannot enter the site with that password. Login displays the policy-specific explanation and sends a fresh migration-activation email link; only after setting a policy-compliant password can the member continue. A confirmed HIBP breach instead displays the breach-specific explanation and requires the same secure replacement. A compliant non-breached imported password upgrades its hash and proceeds through existing email verification and profile onboarding; incorrect passwords remain invalid without sending activation mail.

**Staging evidence:** LIVE-AUTH-039 provisions *two disposable* imported WordPress credentials in `idoc_staging`, tests a real noncompliant first-login/activation link/old-password rejection and a real compliant first-login/OTP flow, and cleans up test accounts and mailboxes. The separate breached-password first-login explanation should additionally be verified with a safe disposable fixture before launch. Staging must retain the communications and billing hold while enabling the staging-only authentication email exception. Do not accept ordinary signup/login results as evidence that legacy first-login behavior was exercised.
