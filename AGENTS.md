# Repository instructions

The Markdown files in `docs/` are the authoritative IDOC project documentation.

For every Codex implementation task, read and follow `docs/09-codex-working-rules.md`.

For every GPT collaboration task—including planning, writing Codex prompts, patching pull requests, handling CI or review feedback, and preparing a handoff—read and follow `docs/10-gpt-collaboration-rules.md`.

For every pull request, read `docs/26-ci-risk-classification-and-agent-merge-policy.md`. Classify the changed files before merging. The fast PR check is sufficient only for changes explicitly listed as low risk. If the policy requires a full workflow, run it against the current PR revision and do not merge until it passes.

For every task that merges into `main`, investigates a difference between `staging.idoc.club` and `redesign.idoc.club`, or otherwise touches deployment branches or environment configuration, read and follow the "Branch, environment, and deployment workflow" section of `docs/07-administrator-and-operations-runbook.md`.

When code changes membership rules, member fields, data structures, authorization, security, billing, migration, notifications, administration, operations, CMS access, seminars, news, or publishing, update the corresponding document in `docs/` in the same pull request. Keep `docs/08-product-roadmap-and-functional-requirements.md` aligned when scope, sequencing, or release gates change.

For any change to an administrator table, drawer or form, read and follow `docs/29-admin-table-and-form-style-guide.md`, and update it in the same pull request when a rule changes.

Do not treat generated Word or PDF files as the source of truth.

## Efficient agent operation (applies to every agent working in this repo, including Claude Code, its subagents, and Codex)

Verification effort must scale with actual risk, not run at maximum thoroughness by default. This repo's own history shows the failure mode in both directions: skipping a check that later broke CI, and burning enormous time/token budget re-running full suites for changes that never needed them. Avoid the second failure mode as deliberately as the first:

1. Classify risk with `docs/26-ci-risk-classification-and-agent-merge-policy.md` before deciding how much to verify, and size the check to the classification. A change docs/26 classifies as low risk gets the fast check, not the full battery "to be safe."
2. Scope checks to what the diff actually touches. A small, single-concern fixup gets a typecheck plus the specific test file(s) covering that code — not a repeat of the full unit/integration/e2e/build suite already run for the commit it's stacked on, unless the fixup itself touches schema, auth, or another genuinely high-risk area.
3. Never re-verify code that already passed verification and hasn't changed since. When stacking another small commit on top of an already-verified one, verify the incremental diff, not the whole history again.
4. Do not spin up a fresh isolated environment (a clean clone or worktree, a full dependency reinstall, a full production build) for a small, low-risk change unless docs/26 actually calls for that level of check. Check directly against a working tree already known to be clean first.
5. Never run the same verification twice — in parallel or in sequence — to double-check work a prior pass already fully covered. One thorough pass beats two redundant ones.
6. When several fixes are already identified together (e.g., multiple review findings on one PR spotted at the same time), fix and verify them in one batch and one push, not one round-trip per finding.
7. When waiting on a slow external process (a review bot, CI), wait for its actual completion signal instead of polling in a tight loop, and never send a duplicate request (e.g. another "please review") while one is already in flight.
8. Report concisely. State what changed, what was checked, and the result — skip narrating routine mechanics (individual commits, individual pushes, intermediate tool calls) that carry no decision for the reader.
9. After pushing a fix for a PR review comment or bot finding, mark that GitHub review thread "Resolved" yourself (the GitHub API/UI action that collapses the thread) in the same round — this is a separate, required step from fixing the underlying code, not implied by it. Do not leave an addressed thread open/uncollapsed for a human to close, and do not wait to be asked. A thread stays open only when it is genuinely still unaddressed.
10. **Never commit or push new work to a pull-request branch after that pull request has been merged or closed.** Before every patch/push, verify the pull request is still open. If it is merged or closed, stop using that branch for the task, branch from the current `staging` head (or `main` only for an explicitly declared production emergency under docs/09), apply the new changes there, and open a new pull request.

## Branch lifecycle and abandoned-work cleanup (all agents)

This policy applies to GPT, Codex, Claude Code, and subagents. Follow the detailed agent-specific rules in `docs/09-codex-working-rules.md` and `docs/10-gpt-collaboration-rules.md`.

1. Every implementation task must have an accountable branch and pull request. Start ordinary work from the latest available `staging`, using one new task branch; do not reuse a merged or closed PR branch, and never directly commit ordinary work to `main` or `staging`. Preserve the documented production-emergency exception.
2. Open a draft PR targeting `staging` in the same step as the first push of a task — never push a task branch and leave it without a PR. Continue subsequent task changes on that same branch and PR; mark ready for review only when implementation is ready. If PR creation is blocked, do not leave the branch published: disclose the exact branch, commit SHA, blocker, and recovery plan, and delete or hold the branch locally. Do not create an empty commit solely to open a PR.
3. A task is not finished merely because code was committed. Follow its PR through required CI, actionable review comments (including resolving addressed threads), and merge when authorized and eligible. Never push further work to a merged or closed PR branch.
4. When abandoning, superseding, or replacing an unfinished task, inventory its branch and PR before starting a replacement. Record whether any unique work must be preserved or transferred. Close an abandoned draft PR with a clear reason; delete the remote branch only after confirming no open PR uses it and no unshipped work would be lost. If deletion is unavailable, report the exact orphan and blocker for later cleanup.
5. Do not enable GitHub's repository-wide automatic deletion of merged PR head branches without explicit owner authorization and enforceable protections or rulesets excluding every intentionally retained branch. Without those guarantees, leave automatic deletion disabled and use reviewed manual cleanup. Verify the actual repository setting before reporting its status. Deleting a branch reference does not immediately remove its commits from Git history.
6. Automated housekeeping may delete only demonstrably safe, no-longer-needed branches after checking fresh refs, open PRs, protected/reserved branches, and retained unique work. Never auto-delete `main`, `staging`, a branch used by an open PR, an explicitly preserved branch, or a branch with uncertain/unshipped changes. Age or lack of a PR alone never proves safety. Closed-unmerged PR branches and untracked orphan branches require explicit safe-disposition evidence or human approval before deletion.
7. Before any bulk deletion, create a durable restoration manifest containing branch name, full tip SHA, decision reason, PR status, and deletion outcome; produce a dry-run report and recheck eligibility immediately before each deletion. Use least-privilege credentials and obey GitHub rules. Stop on authentication/policy denials; do not retry through alternate credentials or bypass controls without fresh user authorization.
8. Keep branch cleanup independent of unrelated code-change PRs. The task report must account for created, merged, abandoned, preserved, and undeletable branches so unfinished work never disappears silently.
9. **Self-cleanup at task completion (standing owner approval).** An agent finishing, abandoning, or superseding a task must delete every remote branch that task created and that is not the head of an open PR or a merged/preserved PR: stray task branches, earlier attempts, and abandoned follow-ups. This is the only standing deletion approval and covers only branches the agent itself created during the task. Before deleting, confirm no open PR uses the branch and record its name and full tip SHA in the task report so it can be restored. If a branch holds work that was never merged and the owner has not said to discard it, ask instead of deleting. Never delete branches created by other agents or people. If deletion is denied or unavailable, stop, report the exact branches, and do not try other credentials. Branches whose PRs merge are removed by GitHub's delete-head-branch-on-merge setting, which must stay enabled.
