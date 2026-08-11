# Codex working rules

These are mandatory instructions for Codex work in `marceloATpixelsmith/idoc.club`. They supplement the repository instructions in `AGENTS.md` and the authoritative project documentation in this directory. If a task-specific instruction is stricter, follow the stricter instruction.

## 1. Repository and pull-request workflow

1. Work only in this repository unless the task explicitly requires an approved external integration.
2. First locate an attached `idoc.club` checkout under `/workspace` or `/tmp` and work in that checkout.
3. Do not stop merely because the checkout has no usable `origin` remote, `gh` is unavailable, or outbound Git HTTPS cloning/fetching is blocked.
4. If an attached checkout exists, continue implementation there. Clone only when no local checkout exists anywhere under `/workspace` or `/tmp`.
5. Stop for repository-access reasons only when no checkout exists and no supported repository integration can provide the needed write access.
6. When `origin/main` is available, begin from its latest state. Never knowingly work from an old branch when `origin/main` is available.
7. If remote fetch is unavailable but a checkout exists, use the attached checkout as the baseline and report that limitation.
8. Create a feature branch when Git permits it. If branch creation is unavailable but a checkout exists, continue and report the limitation.
9. Never commit directly to `main`.
10. Open or update a pull request into `main` when the environment supports it. Do not treat a missing `gh` executable as a blocker when the connected GitHub integration can publish the work.
11. If PR creation is unavailable, complete the changes and report the changed files, validation results, and exact publishing blocker.
12. Do not use `[skip ci]`.

## 2. Scope, architecture, and documentation

1. Read the relevant documents in `docs/` before changing code. Start with [Product Roadmap and Functional Requirements](08-product-roadmap-and-functional-requirements.md), then read the documents governing the affected behavior.
2. Preserve the approved IDOC architecture unless the task explicitly changes it: Next.js on Vercel, Render PostgreSQL in the dedicated `idoc` schema, Stripe for billing, Mailchimp Transactional for notifications, and application-controlled membership entitlement.
3. Do not invent a new architecture, replace approved services, or treat Stripe status as the authorization system.
4. Keep changes focused on the requested task. Do not make unrelated cleanup changes or add unrequested features.
5. Keep code and the governing Markdown documentation aligned in the same pull request whenever behavior changes.
6. When changing imports, helpers, shared package exports, or call sites, update every directly affected test mock, expectation, and relevant documentation entry in the same pull request.
7. Before changing authentication, read all directly related authentication tests. Treat them as behavior contracts. Do not change authentication routing, onboarding, account access, MFA, or external-identity behavior without deliberately preserving or updating the relevant tests.

## 3. Security and data integrity

1. Never expose or log secret values, and never store resolved secret values in the database.
2. Keep database, Stripe, Mailchimp Transactional, authentication, and other privileged credentials server-only.
3. Do not weaken raw-secret rejection or alter existing `secure` calls unless the task explicitly requires it.
4. Enforce authorization server-side at every data-access and mutation boundary. UI visibility alone is never authorization.
5. Do not trust browser-supplied membership, payment, role, professional-level, administrator, or entitlement state.
6. Maintain ownership checks, administrator authorization, audit requirements, and verified/idempotent Stripe webhook handling.
7. Preserve the rule that membership entitlement is the IDOC database record; Stripe and manual payments are inputs that may update it.
8. Do not change security-sensitive behavior without reading [Security and Privacy Requirements](05-security-and-privacy-requirements.md) and the directly related tests.

## 4. Quality and testing

1. Do not claim successful testing unless the test was actually run and passed.
2. Run `npm run check` before final reporting when the repository and environment support it.
3. Run relevant targeted tests when feasible.
4. If testing cannot run, state exactly which command could not run and why.
5. Follow the repository's configured formatting and linting rules in changed files. When Ultracite or Biome is configured, follow its required style, including sorted imports and sorted interface members where required.
6. When this repository uses Vitest or Testing Library:
   - Put repeated regular-expression literals used in tests at top level.
   - Do not use unsupported jest-dom matchers such as `toBeInTheDocument()` or `toBeDisabled()` unless the test setup imports them.
   - Use `toBeDefined()`, `toBeTruthy()`, or focused property assertions when appropriate.
   - Use `cleanup()` when repeated renders could leave duplicate DOM nodes.
   - Avoid fragile queries matching multiple identical labels unless the test deliberately uses `getAllBy...`.
   - Mock `server-only` before importing server-only helpers.
   - Do not use `vi.spyOn(process, "env", "get")`; use a temporary `Proxy` and restore `process.env` if environment access must be tested.

## 5. Reporting

1. State exactly which files changed and why.
2. State the tests and checks run, including their results.
3. If a check was not run, state why.
4. Do not provide partial diffs as the only deliverable; give a concise completed-work summary.

## 6. Rule maintenance

Update this document when the repository's approved tooling, architecture, security controls, or delivery workflow changes. Any exception requires an explicit task instruction and must be recorded in the relevant pull request.