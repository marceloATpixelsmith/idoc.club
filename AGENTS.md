# Repository instructions

The Markdown files in `docs/` are the authoritative IDOC project documentation.

For every Codex implementation task, read and follow `docs/09-codex-working-rules.md`.

For every GPT collaboration task—including planning, writing Codex prompts, patching pull requests, handling CI or review feedback, and preparing a handoff—read and follow `docs/10-gpt-collaboration-rules.md`.

For every pull request, read `docs/26-ci-risk-classification-and-agent-merge-policy.md`. Classify the changed files before merging. The fast PR check is sufficient only for changes explicitly listed as low risk. If the policy requires a full workflow, run it against the current PR revision and do not merge until it passes.

For every task that merges into `main`, investigates a difference between `staging.idoc.club` and `redesign.idoc.club`, or otherwise touches deployment branches or environment configuration, read and follow the "Branch, environment, and deployment workflow" section of `docs/07-administrator-and-operations-runbook.md`.

When code changes membership rules, member fields, data structures, authorization, security, billing, migration, notifications, administration, operations, CMS access, seminars, news, or publishing, update the corresponding document in `docs/` in the same pull request. Keep `docs/08-product-roadmap-and-functional-requirements.md` aligned when scope, sequencing, or release gates change.

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
