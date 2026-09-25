import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/codex-review-gate.yml', 'utf8');

test('the one-time bootstrap path is restricted to approved same-repository repair flows', () => {
  assert.match(workflow, /branches: \[staging, main\]/);
  assert.match(workflow, /github\.event\.pull_request\.number == 282/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /github\.event\.pull_request\.base\.ref == 'main'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.ref == 'staging'/);
  assert.match(workflow, /hotfix\/codex-review-gate-default-branch/);
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

test('the self-nudge only runs once per revision, even for the narrow same-repository bootstrap paths where both pull_request and pull_request_target fire for the same push', () => {
  assert.match(workflow, /name: Ask Codex to review this exact revision\s*\n\s*(?:#.*\n\s*)*if: github\.event_name == 'pull_request_target'/);
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
