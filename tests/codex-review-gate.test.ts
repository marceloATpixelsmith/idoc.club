import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/codex-review-gate.yml', 'utf8');

test('the one-time same-repository bootstrap (PR #282, the staging-to-main promotion, and the default-branch hotfix branch) has been fully retired now that the repair it existed for has landed on both main and staging -- normal operation is pull_request_target only, with no bootstrap pull_request path or job-level event branching left to admit', () => {
  assert.doesNotMatch(workflow, /\n  pull_request:\n/);
  assert.doesNotMatch(workflow, /branches: \[staging, main\]/);
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.number == 282/);
  assert.doesNotMatch(workflow, /hotfix\/codex-review-gate-default-branch/);
  assert.doesNotMatch(workflow, /if: >-/);
  assert.match(workflow, /^on:\n  pull_request_target:\n    types: \[opened, ready_for_review, reopened, synchronize\]\n/m);
});

test('the quota-waiver bootstrap (which matched any past quota-exhaustion comment without binding it to the current head commit) has been removed now that the default-branch gate repair it existed for already landed on main', () => {
  assert.doesNotMatch(workflow, /ALLOW_QUOTA_BOOTSTRAP/);
  assert.doesNotMatch(workflow, /codex_quota_exhausted_url/);
  assert.doesNotMatch(workflow, /reached your Codex usage limits for code reviews/);
  assert.doesNotMatch(workflow, /Quota waiver: default-branch gate repair/);
});

test('Codex gate proactively asks Codex to review each revision instead of only ever passively waiting on an assumed auto-trigger', () => {
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /name: Ask Codex to review this exact revision/);
  assert.match(workflow, /--arg body "@codex review"/);
  assert.match(workflow, /issues\/\$\{PR_NUMBER\}\/comments" \\\n\s+--data-binary @review-request\.json/);
});

test('the self-nudge step has no leftover event-branching guard now that pull_request_target is the workflow\'s only trigger', () => {
  assert.match(workflow, /name: Ask Codex to review this exact revision\n\s*run: \|/);
  assert.doesNotMatch(workflow, /if: github\.event_name == 'pull_request_target'/);
});

test('Codex gate stays visibly in progress while waiting for the current revision', () => {
  assert.match(workflow, /name: Codex review progress/);
  assert.match(workflow, /MAX_WAIT_SECONDS: "1800"/);
  assert.match(workflow, /POLL_SECONDS: "15"/);
  assert.match(workflow, /deadline=\$\(\( \$\(date \+%s\) \+ MAX_WAIT_SECONDS \)\)/);
  assert.match(workflow, /while \(\( \$\(date \+%s\) < deadline \)\)/);
  assert.match(workflow, /--arg state "pending"/);
  assert.match(workflow, /--arg context "codex\/review-complete"/);
});

test('Codex gate accepts both formal reviews and no-findings comments only for the current head', () => {
  assert.match(workflow, /pulls\/\$\{PR_NUMBER\}\/reviews\?per_page=100/);
  assert.match(workflow, /issues\/\$\{PR_NUMBER\}\/comments\?per_page=100/);
  assert.match(workflow, /chatgpt-codex-connector/);
  assert.match(workflow, /chatgpt-codex-connector\[bot\]/);
  assert.match(workflow, /select\(\.commit_id == \$head\)/);
  assert.match(workflow, /find any major issues/);
  assert.match(workflow, /Reviewed commit/);
  assert.match(workflow, /\(\.reviewed_sha \| length\) >= 10/);
  assert.match(workflow, /startswith\(\$comment\.reviewed_sha \| ascii_downcase\)/);
});

test('Codex gate retries API failures, paginates, propagates fetch errors, and finalizes visibly', () => {
  assert.match(workflow, /--connect-timeout 5 --max-time 15 --retry 4 --retry-all-errors/);
  assert.match(workflow, /trap finalize_error ERR/);
  assert.match(workflow, /if ! reviews="\$\(api_get/);
  assert.match(workflow, /if ! comments="\$\(api_get/);
  assert.match(workflow, /page=\$\{page\}/);
  assert.match(workflow, /count < 100/);
  assert.match(workflow, /Codex gate error; see Actions log/);
});

test('Codex gate has a bounded visible failure instead of an indefinite pending state', () => {
  assert.match(workflow, /Codex review not detected within 30 minutes/);
  assert.match(workflow, /post_status "failure"/);
  assert.match(workflow, /exit 1/);
});

test('an administrator-triggered quota waiver that lands while this job is still polling is not immediately overwritten by the timeout path\'s own failure status', () => {
  assert.match(workflow, /current_state="\$\(api_get "\$\{GITHUB_API_URL\}\/repos\/\$\{REPOSITORY\}\/commits\/\$\{HEAD_SHA\}\/status" \| jq -r '\.statuses\[\]\? \| select\(\.context == "codex\/review-complete"\) \| \.state'\)"/);
  assert.match(workflow, /if \[\[ "\$\{current_state\}" == "success" \]\]\s*\n\s*then\s*\n\s*echo "### codex\/review-complete already satisfied"/);
  assert.match(workflow, /not overwriting it with a timeout failure/);
});
