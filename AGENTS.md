# Repository instructions

The Markdown files in `docs/` are the authoritative IDOC project documentation.

For every Codex implementation task, read and follow `docs/09-codex-working-rules.md`.

For every GPT collaboration task—including planning, writing Codex prompts, patching pull requests, handling CI or review feedback, and preparing a handoff—read and follow `docs/10-gpt-collaboration-rules.md`.

For every pull request, read `docs/26-ci-risk-classification-and-agent-merge-policy.md`. Classify the changed files before merging. The fast PR check is sufficient only for changes explicitly listed as low risk. If the policy requires a full workflow, run it against the current PR revision and do not merge until it passes.

When code changes membership rules, member fields, data structures, authorization, security, billing, migration, notifications, administration, operations, CMS access, seminars, news, or publishing, update the corresponding document in `docs/` in the same pull request. Keep `docs/08-product-roadmap-and-functional-requirements.md` aligned when scope, sequencing, or release gates change.

Do not treat generated Word or PDF files as the source of truth.
