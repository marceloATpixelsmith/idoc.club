# Controlled production releases

The IDOC production release is a single, protected GitHub Actions operation. A new commit on `main` no longer starts an automatic Vercel deployment. Staging Git deployment remains enabled.

## Standard promotion

1. Staging PRs must be merged with all required checks green and review threads resolved.
2. Create or reuse the normal `staging` → `main` PR; approve the release through the Super Admin promotion page. If the PR was already merged but the release was interrupted, the same button detects `main...staging` has zero commits ahead and dispatches protected `Auto-migrate Production Schema` on `main` rather than attempting an empty PR.
3. GitHub Actions starts **Monitored staging to production promotion** on `main`. Approve its required `idoc-db-production-maintenance` environment review.
4. The workflow verifies the exact staging SHA, PR and CI; merges the approved PR into `main`; checks out that exact merge SHA; takes an encrypted offsite backup; checks the migration guard; migrates `idoc_production`; verifies the migration ledger; calls the production deploy hook; waits for Vercel status on the merge SHA; and checks the production health endpoint.
5. Only the complete verified run constitutes a successful promotion. If any post-merge step fails, production continues serving the previous working deployment, but the release is incomplete and must be recovered; never assume a green migration job alone means deployment succeeded.

## Required configuration

- GitHub repository secret `IDOC_VERCEL_PRODUCTION_DEPLOY_HOOK_URL`: the Vercel Deploy Hook URL configured specifically for `idoc.club` and `main`. **Keep this secret; it is required.**
- Existing GitHub secrets for database migrations and encrypted R2 backup, and existing `IDOC_R2_BUCKET` variable.
- `PRODUCTION_HEALTH_URL` GitHub variable: the live `https://idoc.club/api/health` endpoint or the current supported `https://redesign.idoc.club/api/health` URL.
- Environment `idoc-db-production-maintenance`: required named reviewer and administrator bypass disabled.
- The Vercel `vercel.json` setting disables automatic Git-triggered deployment for `main` and keeps it enabled for `staging`. Do not set legacy `github.enabled=false` because that also disables Deploy Hooks.

No new secrets are required by this PR. Do not remove the existing hook unless deployment is later replaced with an authenticated exact-commit Vercel API mechanism.

## First-promotion bootstrap

The first promotion carrying this workflow into `main` is a one-time exception: GitHub executes the **old** workflow already on `main`, not the new workflow in the PR being promoted. After the promotion PR is merged, run **Auto-migrate Production Schema** manually from the now-updated `main` branch, or use **Start Monitored Promotion** on staging when staging has zero unmerged commits. Approve the protected environment. The recovery workflow now requires successful backup, migration/ledger verification, a valid Vercel Deploy Hook, verified Vercel READY/status on the exact main SHA, and a healthy production endpoint. A missing hook, failed build or unhealthy site fails the recovery job. Subsequent promotions use the single protected workflow.

Do not mark that first promotion complete until the verified redeployment succeeds. Do not disable the active production site or bypass the deployment schema gate to handle bootstrap.

## Recovery

- Before a merge: correct CI or review failures; no production migration or deployment should occur.
- After a merge but before migration: use **Start Monitored Promotion** on staging if `main...staging` has zero ahead commits, or manually run **Auto-migrate Production Schema** on `main`. The protected recovery workflow requires a named environment approval and a verified encrypted backup, guards the ledger, migrates `idoc_production`, and verifies deployment and health before reporting success.
- After migration but before deployment: re-run the same guarded recovery workflow; its already-applied migration is a no-op, and it triggers a new production deployment of the exact `main` commit and verifies READY and health. Do not revert an applied database migration automatically. Do not rerun an unsafe migration or revert an applied database migration automatically.
- If a deployment fails: leave the last working Vercel production deployment active; inspect Vercel build logs and correct the cause in staging before another promotion.
- Any changes to promotion scripts, migration code, release settings or recovery procedures must be reviewed and tested together in one PR.

## Staging history reconciliation after production promotions

A protected staging-to-main promotion creates a new merge commit on `main`. After a successful production release, merge `main` back into `staging` through a normal reviewed, CI-verified PR before the next promotion. This retains production merge history in staging, prevents comparisons from showing staging as behind or diverged solely due to previous release merge commits, and preserves all staging-only changes. Never bypass staging branch protections or push directly to main to repair history.
