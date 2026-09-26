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

test('Codex review requests are event-driven and never poll for completion', () => {
  assert.match(workflow, /pull_request_target:[\s\S]*pull_request_review:[\s\S]*issue_comment:/);
  assert.match(workflow, /name: Set this revision pending and request review/);
  assert.match(workflow, /--arg body "@codex review"/);
  assert.match(workflow, /issues\/\$\{PR_NUMBER\}\/comments" --data-binary @review-request\.json/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.doesNotMatch(workflow, /MAX_WAIT_SECONDS|POLL_SECONDS|deadline=|while [(]/);
});

test('Codex advisory success is published only after GitHub accepts the review request', () => {
  const requestIndex = workflow.indexOf('issues/${PR_NUMBER}/comments" --data-binary @review-request.json');
  const successIndex = workflow.indexOf('--arg state success --arg context "codex/review-complete"');
  assert.ok(requestIndex >= 0);
  assert.ok(successIndex > requestIndex);
  assert.ok(workflow.includes("Codex review requested (advisory); CI gates are authoritative"));
});

test('Codex review status updates require a connector review of the current PR head', () => {
  assert.match(workflow, /ACTOR_LOGIN/);
  assert.match(workflow, /chatgpt-codex-connector/);
  assert.match(workflow, /pulls\/\$\{PR_NUMBER\}/);
  assert.match(workflow, /CURRENT_SHA/);
  assert.match(workflow, /REVIEWED_SHA/);
  assert.match(workflow, /No Codex review for the current PR revision was found/);
  assert.ok(workflow.includes("Codex review received (advisory); CI gates are authoritative"));
});
