# Schema-isolation execution checklist

Status: implementation and safety tooling are in PR #412. The database cutover has not been executed. The live WordPress site is unrelated.

## Pre-cutover gates

- [ ] PR #412 required CI is green.
- [ ] Zero unresolved PR review comments remain.
- [ ] `scripts/preflight-schema-isolation.mjs` reports the current legacy inventory with no unexpected cross-schema dependencies.
- [ ] `DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING` remains in the protective state.
- [ ] Vercel Project and Shared Environment Variables have both been inspected without exposing secret values.
- [ ] `DB_SCHEMA` has not been activated for `idoc_production` or `idoc_staging`.
- [ ] A separate PostgreSQL restore-verification database is available; it is not the live `ayni_space` database.
- [ ] A full custom-format backup has been restored successfully to that verification database.
- [ ] Source and restored inventories compare exactly.
- [ ] An independent `idoc_staging` archive has been prepared from the verified restored copy.

## Coordinated database cutover

- [ ] Pause Next.js redesign writes and background work for the cutover window. WordPress stays untouched.
- [ ] Reconfirm the live database still contains `idoc` and does not contain either target schema.
- [ ] Run the guarded cutover workflow.
- [ ] Confirm `idoc` was renamed to `idoc_production`, not copied.
- [ ] Confirm `idoc_staging` restored successfully from the verified archive.
- [ ] Confirm staging sessions, temporary credentials, recovery codes, remembered devices, pending outboxes, and open Checkout attempts are quarantined.
- [ ] Run post-cutover validation and require zero mismatches.
- [ ] Run the read-only preflight again and require zero production↔staging catalog dependencies and zero cross-schema textual function references.

## Vercel activation

Only after the database gates above pass:

- [ ] Set project Production `DB_SCHEMA=idoc_production`.
- [ ] Set project Preview `DB_SCHEMA=idoc_staging` restricted specifically to Git branch `staging`.
- [ ] Confirm no Shared Environment Variable named `DB_SCHEMA` conflicts with the project values.
- [ ] Redeploy Production for `redesign.idoc.club` and the staging branch Preview for `staging.idoc.club`.
- [ ] Verify Production refuses `idoc_staging` and Preview refuses `idoc_production`.
- [ ] Verify staging cannot initialize a live Stripe client.
- [ ] Perform a disposable staging-only write and prove the equivalent production record is unchanged.

## QStash staging cutover

- [ ] Keep production schedules unchanged.
- [ ] Verify signed QStash callback delivery to staging.
- [ ] Verify the callback runs against `idoc_staging`.
- [ ] Register staging recurring schedules.
- [ ] Observe successful staging schedule execution.
- [ ] Remove obsolete staging Vercel Cron schedules only after QStash replacements are proven.

## Rollback

If validation fails before Vercel activation, use the guarded rollback action. It preserves the staging copy under a rollback name and restores `idoc_production` to legacy `idoc`.

If failure occurs after Vercel `DB_SCHEMA` activation, stop application/background traffic, execute the database rollback, remove/revert the environment-specific `DB_SCHEMA` values to the legacy default, and redeploy before reopening traffic. Preserve the verified backup until the complete rollout is accepted.

The Render SQL connector available to ChatGPT is read-only. The actual backup/restore/cutover therefore requires an authorized PostgreSQL write/backup path; do not paste database credentials into chat.
