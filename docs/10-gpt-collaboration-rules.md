# GPT collaboration rules

These are mandatory instructions for GPT while collaborating with the client on `marceloATpixelsmith/idoc.club`. They govern planning, Codex prompts, CI and review follow-up, direct pull-request patching, and handoffs. They supplement `AGENTS.md`, document 09, and the authoritative project documentation in this directory.

## 1. Codex prompts

1. Start with a broad Codex prompt. Tighten later prompts only when the prior approach averages more than two rounds of CI errors or pull-request review comments.
2. Every Codex prompt must include the complete rule set from [Codex Working Rules](09-codex-working-rules.md), without exception.
3. Do not ask Codex to target a pull request by number. Each Codex prompt must assume earlier pull requests are close and merged, then instruct Codex to work from the latest available `main`.
4. Keep Codex prompts scoped to the approved task and aligned with the architecture, security, documentation, and testing requirements in the governing documents.

## 2. CI failures and pull-request review comments

1. When the client provides a CI failure to resolve, also check for unresolved review comments on that pull request and include them in the same repair where applicable.
2. Handle CI failures and review comments by GPT directly patching the affected pull-request branch files so the final update initiates a fresh CI check.
3. For a sequence of manual GPT patch commits to the same pull-request branch, every commit except the final commit must include `[skip ci]`. The final patch commit must omit `[skip ci]` so CI runs once after the full repair.
4. This `[skip ci]` rule is GPT-only. Codex must never use `[skip ci]`, because Codex prompts must batch related changes.
5. Before every manual patch, inspect the affected file(s) closely enough to preserve repository formatting and behavior. Validate every changed file against the repository's configured formatting rules; when Ultracite or Biome is configured, verify that the patch follows it.
6. Give the client manual-edit instructions only when the affected source can be retrieved completely and safely and the repair is reasonably bounded.
7. If more than ten files require modification, or any needed file is too large to retrieve whole and intact for safe manual editing, provide a Codex prompt to resolve the issue instead. That prompt must assume the failing pull request may be merged with its errors so Codex can begin from `main`; this temporary development-stage exception does not authorize production-risky changes.
8. If CI was green and a review comment appears only after the pull request merged, create a new pull request for the repair and run CI on that new pull request.
9. Whenever the client says a pull request is green and merged and asks for the next task, first check whether unresolved review comments appeared. Address them before proposing the next broad Codex prompt.

## 3. Handoffs and project continuity

1. When the client asks for a handoff prompt to continue with GPT, direct the new GPT thread to read and follow this document before acting.
2. State the active task, its approved scope, every identified area of change, current repository and pull-request status, completed checks, and unresolved blockers or decisions.
3. Require the successor to align all work with best practices and current industry standards for paid SaaS products, as applicable to IDOC.
4. Do not rely on memory alone when the repository is available. Read the governing documentation and relevant current files before giving implementation advice or patches.

## 4. Reporting and safeguards

1. State clearly whether work was planned, patched, committed, published, or blocked.
2. Do not represent a CI result, review status, formatting check, or pull-request state as successful unless it was actually verified.
3. Keep all work narrowly within the approved task. Do not silently add unrelated cleanup, product scope, architecture, security, or policy changes.
4. When project behavior changes, ensure the governing documentation is updated in the same pull request.
5. If a project instruction conflicts with system safety requirements or available permissions, explain the constraint and use the safest compliant path.
