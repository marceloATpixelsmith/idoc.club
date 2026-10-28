# Controlled production releases

The IDOC production release is a single, protected GitHub Actions operation. A new commit on `main` no longer starts an automatic Vercel deployment. Staging Git deployment remains enabled.

## Standard promotion

1. Staging PRs must be merged with all required checks green and review threads resolved.
2. Create the normal `staging` → `main` PR; approve the release through the Super Admin promotion page.
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

The first promotion carrying this workflow into `main` is a one-time exception: GitHub executes the **old** workflow already on `main`, not the new workflow in the PR being promoted. After the promotion PR is merged, run **Auto-migrate Production Schema** manually from the now-updated `main` branch, approve its protected environment, and confirm that its successful backup/migration/ledger verification triggers the Vercel Deploy Hook. Confirm Vercel reaches READY for the intended merge SHA and verify the live health endpoint. Subsequent promotions use the single protected workflow.

Do not mark that first promotion complete until the verified redeployment succeeds. Do not disable the active production site or bypass the deployment schema gate to handle bootstrap.

## Recovery

- Before a merge: correct CI or review failures; no production migration or deployment should occur.
- After a merge but before migration: use the protected manual production migration recovery workflow. It takes its own mandatory backup and verifies the ledger.
- After migration but before deployment: once the ledger is verified, trigger a new production deployment of the exact `main` commit through the existing hook or the Vercel project interface, then verify READY, production domains and health. Do not rerun an unsafe migration or revert an applied database migration automatically.
- If a deployment fails: leave the last working Vercel production deployment active; inspect Vercel build logs and correct the cause in staging before another promotion.
- Any changes to promotion scripts, migration code, release settings or recovery procedures must be reviewed and tested together in one PR.
