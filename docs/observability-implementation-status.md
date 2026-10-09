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
| **Verified — ingest** | Dedicated IDOC application spans | New Relic observed `service.name = 'idoc.club'` (752 spans over 24h in a prior check, 10 in 15m). Application instrumentation initializes on Node.js; staging runtime logged `[idoc.otel] initialization` with endpoint/header/direct-exporter enabled. | APM metric ingestion verified 2026-10-09; continue privacy and sampling review. |
| **Verified — configured** | OTLP app exporter | `@vercel/otel`, explicit Node.js trace exporter; Vercel shared `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and `OTEL_EXPORTER_OTLP_TRACES_HEADERS` linked to IDOC; leave trace drain enabled for platform spans. | Verify current deployed configuration following future deploys. |
| **Verified — installed** | Vercel New Relic integration | Team integration installed and configured for all projects (checked 2026-10-09). | Avoid duplicate drains/exporters and excessive shared project ingestion. |
| **Verified — existing** | Sentry | Sentry integration installed; instrumentation coexists with app OpenTelemetry without a competing Vercel trace provider. | Evaluate error correlation with trace/request IDs. |
| **Verified — 2026-10-09** | GitHub deployment-marker workflow | `.github/workflows/new-relic-idoc-deployments.yml` uses Vercel successful `deployment_status` and validates deployment SHA against current `staging` head (Preview) or `main` head (Production). Fix in PR [#419](https://github.com/marceloATpixelsmith/idoc.club/pull/419), reported merged 2026-10-09. GitHub repository secret `NEW_RELIC_API_KEY` is a **user** key (different from ingest key). | Verified GitHub Actions `record-deployment` job and New Relic Change Tracking event for staging SHA `81d413b81c643ccbded6b0f36433a4f2320f1961`; event ID `0ca601ad-e388-46de-9614-65059f3d3c91`. |
| **Verified — build correction** | PR Preview migrations | PR #419 corrected Vercel build behavior so ordinary feature-branch PR previews skip database migrations; staging/production still migrate. Its checks were green prior to reported merge. | Independently verify a subsequent staging build migrates and an ordinary PR preview builds without secrets. |

Historical references: PR #414 introduced deployment marker workflow; #415–#417 established dedicated IDOC tracing and safe diagnostics; #419 fixed Vercel SHA matching and preview migration gating. Treat merge history as implementation evidence, **not** as end-to-end monitoring proof.

## Partially working or unverified

| Priority | Signal | Current evidence / issue | What would count as completion |
|---|---|---|---|
| **Verified — 2026-10-09** | **Application APM metrics** | Staging Vercel logs confirmed OTLP metric export accepted HTTP 200; New Relic NRQL (past hour) returned `http.server.duration`, `apm.service.transaction.duration`, `apm.service.transaction.overview`, and `apm.service.transaction.sampled_duration`. Dedicated `idoc.club` OpenTelemetry APM Summary screenshot showed Web transactions time (416.69 ms app server), Apdex (0.81), throughput chart and errors (0%) with recent transaction data. | Monitor accuracy and volume under normal traffic; low staging volume means an average displayed as 0.00 rpm across the selected one-week window, and does not establish load-test p95/p99 precision. |
| **Verified — 2026-10-09** | **Deployment change events** | GitHub `record-deployment` workflow [run 37958326543](https://github.com/marceloATpixelsmith/idoc.club/actions/runs/37958326543) succeeded for staging commit `81d413b81c643ccbded6b0f36433a4f2320f1961`; branch-head comparison was true; New Relic API returned created change event `0ca601ad-e388-46de-9614-65059f3d3c91`. User screenshot of `idoc.club` Change Tracking showed three events, with this commit/version at Oct 9 2026 16:20:02.793 and description `Successful IDOC Vercel deployment (Preview)`, plus events for `28a70ea...` and `da756f...`. | Staging path verified; production/main path has not been exercised and must not be promoted without approval. |
| **P1 — recovering / monitor** | **Render logs in New Relic** | On 2026-10-09, New Relic recorded 62 RFC 5424 validation errors in a three-hour window, nearly two every five minutes until approximately 16:36 UTC. An overlapping 45-minute NRQL window (16:21:38–17:06:38 UTC) confirmed 828 accepted `plugin.type = 'syslog-newrelic'` logs and six errors, with **zero errors for the final six five-minute intervals** while 448 accepted messages continued. Render workspace stream destination was visually confirmed as `newrelic.syslog.nr-data.net:6514`; it is shared by other services. No corrective config changes were made, so cause of recovery is unknown. | Keep Task 03 open until absence of recurrence is confirmed over a longer observation interval and the intended Render database/service log sources are shown to be covered. If errors return, correlate precise timestamps and periodic output before changing the workspace-wide stream. |
| **P1 — implementation awaiting validation** | **Render/Postgres performance metrics** | Render Basic does not provide Metrics Stream (Pro-only). Implemented a manually invoked, staging-only collector in a staging PR for shared-database built-in aggregate stats (connections, committed and rolled-back transactions, deadlocks, waiting locks, database size). It sends gauges to New Relic through existing ingest credentials; no new secrets or database permissions. Render CPU/memory remain visible only in the Render dashboard; no continuous metric schedule is enabled. | Verify authorized staging POST and metrics in New Relic. Confirm aggregation semantics and permissions, then decide whether to enable a production cadence through a separately approved promotion. Query timings/slow-query analysis remain separate and require tighter permission review. |
| **P2** | **GitHub CI and deploy correlation** | GitHub deployment workflow installed; no full, verified CI/deployment monitoring dashboard yet. | Correlate failed builds, commits and deployed versions in a documented New Relic view. |
| **P2** | **Alert policies and notification routing** | No verified policy/route inventory. | Test a low-risk staging alert and confirm delivery to designated recipient without spurious production notifications. |
| **P2** | **Synthetic uptime / critical-path checks** | Not verified. | Cover homepage, login availability and seminars, then safe synthetic authenticated flows with nonmember-impacting test identities. |
| **P2** | **Browser real-user monitoring** | Not verified. | Measure page timings/Core Web Vitals and browser errors while excluding sensitive content, credentials and addresses. |
| **P3** | **Application and external service health** | No verified unified instrumentation for Stripe webhook processing, Brevo delivery, Cloudinary uploads, background jobs, and auth/reconciliation workflows. | Instrument critical durations, failure counts and retry/backlog health using aggregate/non-sensitive attributes. |
| **P3** | **Cross-platform dashboards** | No verified production-ready IDOC dashboard. | Separate staging/production and app/platform/shared-DB views; meaningful panels and links to traces, logs, Sentry and deployments. |

## Ordered task queue — do only one item per session or explicit instruction

- [x] **01 — Complete application APM metrics (P0).** Inspect existing instrumentation and New Relic metric names, implement minimally scoped metric export compatible with current Next.js/Vercel stack, verify staging request/error/latency metrics and privacy.
- [x] **02 — Verify post-merge deployment markers (P1).** Read GitHub deployment-status run after PR #419 and New Relic IDOC Change Tracking. If absent, diagnose that precise failure and fix it in one staging PR; do not declare complete until an actual marker is visible. *No code change necessary if already working.*
- [ ] **03 — Repair Render syslog delivery.** Format errors stopped in the final 30 minutes of the 2026-10-09 observation window, with ongoing successful ingestion; **monitor for recurrence** and verify intended Render source coverage before closing. No configuration change was needed yet.
- [ ] **04 — Add PostgreSQL performance monitoring.** Read-only aggregate collector implemented for protected manual staging validation; not yet scheduled or fully verified. Confirm Render workspace/instance with user before database operations; start with read-only discovery and minimal-privilege collector design; shared DB/schema isolation matters.
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

### APM metrics implementation and verification (Task 01 complete)

The Next.js 15 service emits OpenTelemetry HTTP server spans with `http.method` (GET/POST) and internal spans, but the 2026-10-09 New Relic metric-name query yielded only `apm.service.transaction.overview` and `apm.service.transaction.sampled_duration`; `apm.service.transaction.duration` was absent. A follow-up 24-hour span query showed 229 GET server spans, 2 POST server spans and 594 internal spans. The APM overview requires a real HTTP server-duration histogram. The IDOC instrumentation now derives the documented old-semantic-convention `http.server.duration` delta histogram (milliseconds, `http.method`, optionally safe `http.route`, HTTP 5xx status) from existing Node.js server spans and sends OTLP/HTTP JSON to the fixed US New Relic metrics endpoint. It reuses the existing encrypted trace ingest credential; no additional environment variable is needed. It does not export URLs, raw request data, email, session IDs or authentication payloads, and avoids duplicate server spans. Exports are best-effort: tracing continues if metric delivery fails. This approach uses already-exported spans, so accuracy is constrained by span sampling; it is not a substitute for independent unsampled request metrics at scale.

**End-to-end verification completed 2026-10-09:** PR #422 provided the OTLP metric export and PR #426 added a privacy-safe first-success acknowledgment; both merged to `staging`. The deployment from PR #426 (`81d413b81c643ccbded6b0f36433a4f2320f1961`) was READY with `staging.idoc.club` assigned. GET `/`, `/seminars`, `/news`, and `/api/user` returned HTTP 200. Vercel runtime logged `[telemetry] metric export accepted { status: 200 }` at 16:20:15 UTC, with no metric export failure warnings in the checked window. User supplied a New Relic NRQL screenshot (one-hour metricName query scoped to `service.name = 'idoc.club'`) confirming `http.server.duration`, `apm.service.transaction.duration`, `apm.service.transaction.overview`, and `apm.service.transaction.sampled_duration`. A second screenshot of New Relic APM & Services → `idoc.club` → Summary (one-week window) showed transaction response time (416.69 ms), throughput data, 0% errors, Apdex 0.81 and recent Web transactions. Task 01 is complete for staging APM visibility; low staging traffic and the long chart window limit what can be inferred about statistical tail latency, sustained throughput and error rates. No new environment variables were needed.

### Deployment Change Tracking verified (Task 02 complete)

On 2026-10-09, the GitHub Actions [record-deployment run](https://github.com/marceloATpixelsmith/idoc.club/actions/runs/37958326543) executed its eligibility gate successfully (`environment=Preview`, `expected branch=staging`, `matches current head=true`) and its `Record IDOC change in New Relic` step completed with success. New Relic returned changeTrackingId `0ca601ad-e388-46de-9614-65059f3d3c91` for deployed commit/version `81d413b81c643ccbded6b0f36433a4f2320f1961`. A user-supplied screenshot of `idoc.club` → Change tracking confirmed a visible row for that version and two other staging deployments (versions beginning `28a70ea` and `da756f3`), all marked `Successful IDOC Vercel deployment (Preview)`. Task 02 is verified for staging. Production-side event generation is not tested.

## Progress log

| Date | Result | Evidence / limitation |
|---|---|---|
| 2026-10-08–09 | Vercel log/trace drains configured, dedicated app instrumentation created | New Relic showed IDOC-specific spans; runtime init flags verified. |
| 2026-10-09 | Found skipped deployment-marker jobs | Vercel GitHub deployment event had `environment=Preview`, `state=success`, but `deployment.ref` was SHA `2e97866...`, not `staging`. |
| 2026-10-09 | PR #419 corrected deployment marker gate and PR preview build gating, updated from staging; reported merged | Prior to merge: Fast PR verification green, Vercel Preview green, no open review threads. **Change event not yet independently verified.** |
| 2026-10-09 | Created this observability ledger | Documentation only; subsequent task results must be added here. |
| 2026-10-09 | PR #422 merged to staging | OTLP `http.server.duration` code exists; instrumentation initializes on staging with exporter enabled and fresh GET responses returned 200, but New Relic ingestion/APM remains unverified. A separate follow-up PR adds an initial successful-ingestion log without sensitive payload details. |
