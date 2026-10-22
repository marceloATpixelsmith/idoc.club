# GPT collaboration rules

These are mandatory instructions for GPT while collaborating with the client on `marceloATpixelsmith/idoc.club`. They govern planning, Codex prompts, CI and review follow-up, direct pull-request patching, and handoffs. They supplement `AGENTS.md`, document 09, and the authoritative project documentation in this directory.

## Mandatory PR ownership and completion for every GPT task

The **Mandatory task-to-merge PR completion contract** in `AGENTS.md` applies to every GPT task and every Codex/Claude prompt, delegation, patch, or handoff. First check for the task's existing open PR; keep all requested changes and subsequent fixes in **that single non-draft PR** unless the owner approves a split. Personally follow CI, all required workflows, review submissions, **resolution and collapse of every addressed thread**, branch currency, and mergeability through successive repair/check rounds. Once the **current head** is green, every thread is resolved/closed/collapsed, the branch is current, required approvals are satisfied, and no owner hold remains, **merge to `staging` immediately without asking**, verify success, and provide its URL. Do not merge to `main` without the explicit production-promotion authorization. If blocked or checks remain pending at the end of execution, report that accurately and specify continuation rather than claiming background monitoring.

## 1. Codex prompts

1. Start with a broad Codex prompt. Tighten later prompts only when the prior approach averages more than two rounds of CI errors or pull-request review comments.
2. Every Codex prompt must include the complete rule set from [Codex Working Rules](09-codex-working-rules.md), without exception.
3. Before prompting Codex, check whether the task already has an open pull request. If so, instruct Codex to continue that same open PR (identify it precisely); otherwise instruct Codex to start from current `staging` and create one new PR into `staging` — per docs/07's branch policy, `main` receives only reviewed promotions, never ordinary Codex work directly. **Exception:** when the prompt is for an explicitly declared production emergency, instruct Codex to work from `main` and open its PR into `main` instead, per docs/09 rule 6's `main`-then-back-merge exception — `staging` may carry unpromoted, unverified backlog that an emergency fix must not pull in.
4. Keep Codex prompts scoped to the approved task and aligned with the architecture, security, documentation, and testing requirements in the governing documents.

## 2. CI failures and pull-request review comments

1. When the client provides a CI failure to resolve, also check for unresolved review comments on that pull request and include them in the same repair where applicable.
2. Handle CI failures and review comments by GPT directly patching the affected pull-request branch files so the final update initiates a fresh CI check.
3. For a sequence of manual GPT patch commits to the same pull-request branch, every commit except the final commit must include `[skip ci]`. The final patch commit must omit `[skip ci]` so CI runs once after the full repair.
4. This `[skip ci]` rule is GPT-only. Codex must never use `[skip ci]`, because Codex prompts must batch related changes.
5. Before every manual patch, inspect the affected file(s) closely enough to preserve repository formatting and behavior. Validate every changed file against the repository's configured formatting rules; when Ultracite or Biome is configured, verify that the patch follows it.
6. Give the client manual-edit instructions only when the affected source can be retrieved completely and safely and the repair is reasonably bounded.
7. If more than ten files require modification, or any needed file is too large to retrieve whole and intact for safe manual editing, delegate repair to Codex on the **same existing open PR**, not a replacement branch or PR. If that PR has already merged or closed, use a new PR from current `staging` for additional work (subject to the documented production-emergency exception). Do not bypass risk-required CI or review gates.
8. If CI was green and a review comment appears only after the pull request merged, create a new pull request for the repair and run CI on that new pull request.
9. Before any GPT-authored patch or push, verify the target pull request is still open. **Never add new commits to a branch whose pull request is merged or closed.** If the pull request has merged or closed, create a fresh branch from the current `staging` head, apply the new change there, and open a new pull request into `staging` (except an explicitly declared production emergency, which follows docs/09's `main` workflow).
10. Whenever the client says a pull request is green and merged and asks for the next task, first check whether unresolved review comments appeared. Address them before proposing the next broad Codex prompt.

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

## 5. Branch lifecycle and orphan prevention

These requirements apply to GPT's own GitHub actions, Codex prompts, Claude Code handoffs, and delegated/subagent implementation.

1. Require one fresh task branch from current `staging` for ordinary changes and a regular, non-draft PR in the same step as the first push. Never create or convert PRs to draft; an open PR is already proposed, unmerged code. When work must remain unmerged while further commits are expected, use the `hold-merge` label and an explanatory comment instead. In prompts and handoffs, require the agent to continue on the same open PR for its follow-up fixes rather than generating replacement branches, and to delete every remote branch it created that is not the head of an open or preserved PR when the task finishes or is abandoned (`AGENTS.md` item 9). Preserve the documented production-emergency exception.
2. Do not leave newly published work without a PR or an explicitly reported publishing blocker. If blocked, record the remote branch, full tip SHA, unshipped-change status, and next action. Before starting a replacement task, reconcile previous abandoned branches and PRs.
3. When a task is abandoned or superseded, establish whether its work was merged or otherwise preserved, close an unused open PR with an explanatory note, and delete its branch only when authorized and provably safe. If the tooling cannot delete remote refs, report the exact pending cleanup and do not claim completion or route around an authorization denial.
4. Do not enable or recommend GitHub's repository-wide automatic deletion of merged PR branches unless the owner explicitly authorizes it and every intentionally retained branch has an enforceable deletion exclusion (such as a matching protection rule or ruleset). Verify its configuration; otherwise use reviewed manual cleanup. For historical/scheduled cleanup require a fresh branch and PR inventory, exclusion of `main`, `staging`, all open-PR and explicitly retained branches, a dry run, a durable branch/SHA/reason restoration manifest, and revalidation immediately before deletion. Never delete unique or uncertain unshipped work based solely on age or absence of a PR.
5. Treat orphan detection and automated deletion as separate actions: stale branches can be flagged for review; a branch with no PR or a closed unmerged PR is not disposable by default. Report deleted, skipped, preserved, and blocked branches distinctly.
6. Keep housekeeping policy changes separate from a one-time bulk deletion and unrelated feature PRs. The only standing approval to delete branches is the self-cleanup of an agent's own task branches in `AGENTS.md` item 9; do not interpret this policy as approval to delete anyone else's branches, run bulk deletions, or change GitHub repository settings.

## Repository-wide coordination across GPT, Codex and Claude

The **Cross-agent PR coordination and anti-proliferation** section in `AGENTS.md` is mandatory in every GPT action, Codex prompt, Claude handoff and delegated task. Before asking another agent to open a PR, inspect *all* open PRs for overlap and existing repair work; pass the exact existing PR number, branch, active holds, dependencies and required merge order. Do not send independent agents to fix the same open PR or generate follow-up repair PRs. Keep durable coordination notes in GitHub rather than relying on chats. Check results on the current head, resolve/collapse review threads, and automatically merge authorized staging PRs when clean; reserve production promotion for explicit authorization. Preserve the existing rules in this document.
