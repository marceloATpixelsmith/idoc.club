# IDOC observability — implemented configuration, verification, and remaining work

**Last reviewed:** 2026-10-09
**Scope:** IDOC Next.js on Vercel, Render PostgreSQL, GitHub Actions, New Relic US, Sentry, and relevant external service workflows.
**Execution policy:** Work **one task at a time**, starting with the highest-priority unchecked item. Changes go to `staging` via one PR per coherent task; do not promote to `main` or touch the live WordPress site without explicit direction. Fix CI and review comments before merging. Record completed work and evidence here after **each** task.

This document is the **status ledger and roadmap**. For operational secrets, configuration and troubleshooting see [administrator and operations runbook](07-administrator-and-operations-runbook.md), section **New Relic observability and deployment change tracking**. That runbook is the authority for current implementation mechanics. Do not record tokens, connection URLs, API keys or user data here.

## Status definitions

- **Verified**: directly observed working telemetry/configuration or an observed green deployment (with evidence noted).
- **Configured / unverified**: installed or wired, but end-to-end data or correctness is not yet confirmed.
- **Partial / problem**: some output exists, but a significant gap or failure remains.
- **Planned**: not yet implemented, or there is insufficient evidence to claim implementation.

**Important:** A passing PR/CI run is **not** equivalent to verified production telemetry, complete APM, or successful deployment change tracking.

## Infrastructure, scopes, and identity

| Component | ID / target | Important separation |
|---|---|---|
| Source repository | `marceloATpixelsmith/idoc.club`; staging branch `staging` | PR branches are not staging deployments |
| Vercel project | `idoc.club`, project `prj_OQ45skGMvZt6XB0ieDfsyqyp7Sb4`, team `ayni-team` | Preview deployments can include PR previews |
| Current redesign staging | `staging.idoc.club` | Main implementation and testing target |
| Production redesign | `redesign.idoc.club` | Do not deploy/promote without permission |
| Existing public WordPress | `idoc.club` | Must remain unaffected by redesign telemetry work |
| New Relic | US region, account `8600002`, dedicated service name `idoc.club` | `vercel.edge-network` and `vercel.serverless-runtime` are shared platform services |
| Render PostgreSQL | Oregon; IDOC schema `idoc` | Database instance is shared across applications; avoid attributing all DB logs to IDOC |
| Sentry | Vercel integration enabled | Retain separate application error-monitoring coverage |

## Completed and confirmed components

| Status | Component | Configuration / evidence | Follow-up |
|---|---|---|---|
| **Verified — configured** | New Relic Vercel log drain | Enabled, `drn_bfc1BdMuGQjIpJal`; receives build, edge, lambda, external and firewall logs for production/preview at team integration scope (checked 2026-10-09). | Validate the expected events/attributes by environment and project, set retention/access rules. |
| **Verified — configured** | New Relic Vercel trace drain | Enabled, `drn_nv9vqWewYZbEWo7s`; OTLP HTTP/Protobuf US endpoint `https://otlp.nr-data.net/v1/traces` (checked 2026-10-09). | Confirm platform span attribution and sampling. |
| **Verified — ingest** | Dedicated IDOC application spans | New Relic observed `service.name = 'idoc.club'` (752 spans over 24h in a prior check, 10 in 15m). Application instrumentation initializes on Node.js; staging runtime logged `[idoc.otel] initialization` with endpoint/header/direct-exporter enabled. | Add missing APM metrics; protect member data in spans. |
| **Verified — configured** | OTLP app exporter | `@vercel/otel`, explicit Node.js trace exporter; Vercel shared `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and `OTEL_EXPORTER_OTLP_TRACES_HEADERS` linked to IDOC; leave trace drain enabled for platform spans. | Verify current deployed configuration following future deploys. |
| **Verified — installed** | Vercel New Relic integration | Team integration installed and configured for all projects (checked 2026-10-09). | Avoid duplicate drains/exporters and excessive shared project ingestion. |
| **Verified — existing** | Sentry | Sentry integration installed; instrumentation coexists with app OpenTelemetry without a competing Vercel trace provider. | Evaluate error correlation with trace/request IDs. |
| **Merged / awaiting event confirmation** | GitHub deployment-marker workflow | `.github/workflows/new-relic-idoc-deployments.yml` uses Vercel successful `deployment_status` and validates deployment SHA against current `staging` head (Preview) or `main` head (Production). Fix in PR [#419](https://github.com/marceloATpixelsmith/idoc.club/pull/419), reported merged 2026-10-09. GitHub repository secret `NEW_RELIC_API_KEY` is a **user** key (different from ingest key). | **Not yet verified** that a new successful staging deployment creates a New Relic Change Tracking event. |
| **Verified — build correction** | PR Preview migrations | PR #419 corrected Vercel build behavior so ordinary feature-branch PR previews skip database migrations; staging/production still migrate. Its checks were green prior to reported merge. | Independently verify a subsequent staging build migrates and an ordinary PR preview builds without secrets. |

Historical references: PR #414 introduced deployment marker workflow; #415–#417 established dedicated IDOC tracing and safe diagnostics; #419 fixed Vercel SHA matching and preview migration gating. Treat merge history as implementation evidence, **not** as end-to-end monitoring proof.

## Partially working or unverified

| Priority | Signal | Current evidence / issue | What would count as completion |
|---|---|---|---|
| **P0** | **Application APM metrics** | New Relic IDOC service exists but APM summary warned **“Required metrics are missing.”** Application spans alone do not satisfy the metrics requirement. | Request rate, errors, response-time distribution/p95–p99, and appropriate runtime/service metrics appear in the dedicated service; validate against actual staging traffic. |
| **P1** | **Deployment change events** | Prior New Relic Change Tracking query showed **0 events** even for 7 days. Earlier Vercel deployment refs contained commit SHAs, triggering GitHub job skip. PR #419 fixed the gate; post-merge event still needs proof. | Deploy a new staging SHA; see a non-skipped green deployment-marker GitHub Actions job **and** the corresponding New Relic IDOC Change Tracking event with commit/version/link. |
| **P1** | **Render logs in New Relic** | Earlier Render syslog integration reported `NrIntegrationError`, including `LogValidationException` / “Syslog message was not in RFC 5424 format.” Some Render log entries were visible. | Fix formatting/delivery without silently dropping logs; verify logs from the intended database/service and no new validation errors; distinguish shared DB logs from IDOC. |
| **P1** | **Render/Postgres performance metrics** | Not yet verified as connected. | Appropriate collector/integration safely reports connections, memory/CPU where available, locks, query activity and slow queries; no expansion of unrelated schema/database access. |
| **P2** | **GitHub CI and deploy correlation** | GitHub deployment workflow installed; no full, verified CI/deployment monitoring dashboard yet. | Correlate failed builds, commits and deployed versions in a documented New Relic view. |
| **P2** | **Alert policies and notification routing** | No verified policy/route inventory. | Test a low-risk staging alert and confirm delivery to designated recipient without spurious production notifications. |
| **P2** | **Synthetic uptime / critical-path checks** | Not verified. | Cover homepage, login availability and seminars, then safe synthetic authenticated flows with nonmember-impacting test identities. |
| **P2** | **Browser real-user monitoring** | Not verified. | Measure page timings/Core Web Vitals and browser errors while excluding sensitive content, credentials and addresses. |
| **P3** | **Application and external service health** | No verified unified instrumentation for Stripe webhook processing, Brevo delivery, Cloudinary uploads, background jobs, and auth/reconciliation workflows. | Instrument critical durations, failure counts and retry/backlog health using aggregate/non-sensitive attributes. |
| **P3** | **Cross-platform dashboards** | No verified production-ready IDOC dashboard. | Separate staging/production and app/platform/shared-DB views; meaningful panels and links to traces, logs, Sentry and deployments. |

## Ordered task queue — do only one item per session or explicit instruction

- [ ] **01 — Verify post-merge deployment markers.** Read GitHub deployment-status run after PR #419 and New Relic IDOC Change Tracking. If absent, diagnose that precise failure and fix it in one staging PR; do not declare complete until an actual marker is visible. *No code change necessary if already working.*
- [ ] **02 — Complete application APM metrics.** Inspect existing instrumentation and New Relic metric names, implement minimally scoped metric export compatible with current Next.js/Vercel stack, verify staging request/error/latency metrics and privacy.
- [ ] **03 — Repair Render syslog delivery.** Diagnose malformed RFC 5424 messages, make the smallest safe configuration fix, verify New Relic ingestion.
- [ ] **04 — Add PostgreSQL performance monitoring.** Confirm Render workspace/instance with user before database operations; start with read-only discovery and minimal-privilege collector design; shared DB/schema isolation matters.
- [ ] **05 — Correlate GitHub CI, deployment and application trace/log evidence.** Test one successful and one failed workflow path without changing production.
- [ ] **06 — Add browser RUM (staging first).** Check framework compatibility, event data privacy, and collect core vitals/errors.
- [ ] **07 — Add synthetic monitoring.** Start with non-authenticated staging endpoint checks; only then safe test-account flows.
- [ ] **08 — Create prioritized alert policies and notification destinations.** Verify delivery, coverage, thresholds and deduplication.
- [ ] **09 — Instrument background jobs and external integrations.** Start with failures, retries, queue delays and webhook processing; never log secrets/payment payloads.
- [ ] **10 — Create and verify consolidated dashboards.** Explicitly separate IDOC staging, IDOC production, Vercel platform signals and shared Render infrastructure.
- [ ] **11 — Perform end-to-end audit.** Trigger safe test cases, check traces/logs/metrics/alerts/links, document remaining gaps and cost/retention.

The task order may be changed **only when the user asks** or when a blocking dependency requires it; update this ledger first. Do not silently group tasks into a larger rollout.

## Security, billing and operating guardrails

- Staging first; **no production promotion** and no modifications to the live WordPress website without explicit consent.
- Never publish secret values in GitHub Actions logs, documentation, analytics query examples, issue comments or chat. Configure user API key only in GitHub Actions secret `NEW_RELIC_API_KEY`; Vercel OTLP headers use encrypted environment configuration.
- Render PostgreSQL is **shared**, so confirm workspace/instance and schemas before permission changes. Creating dedicated PostgreSQL roles does **not** itself alter Render's default connection URL; exact grants and role ownership must be audited before claiming complete isolation.
- Do not expand trace URLs/attributes to include emails, addresses, access tokens, precise coordinates, passwords, session identifiers, or payment details. Outbound fetch URL span suppression is intentional.
- Confirm New Relic data volume, retention and alert-notification costs before high-volume instrumentation. Avoid doubling instrumented spans between app direct exporter and Vercel trace drain.
- For new GitHub or Vercel environment variables, record the **key name, scope and instructions** in the relevant PR/runbook, but never record actual secrets.
- Every code change: check existing open PRs, target `staging`, use one PR, resolve all comments/checks, then merge under the project's merge rules. **Link the PR**.

## Progress log

| Date | Result | Evidence / limitation |
|---|---|---|
| 2026-10-08–09 | Vercel log/trace drains configured, dedicated app instrumentation created | New Relic showed IDOC-specific spans; runtime init flags verified. |
| 2026-10-09 | Found skipped deployment-marker jobs | Vercel GitHub deployment event had `environment=Preview`, `state=success`, but `deployment.ref` was SHA `2e97866...`, not `staging`. |
| 2026-10-09 | PR #419 corrected deployment marker gate and PR preview build gating, updated from staging; reported merged | Prior to merge: Fast PR verification green, Vercel Preview green, no open review threads. **Change event not yet independently verified.** |
| 2026-10-09 | Created this observability ledger | Documentation only; subsequent task results must be added here. |
