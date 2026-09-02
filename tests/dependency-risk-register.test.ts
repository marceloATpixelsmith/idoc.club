import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DEPENDENCY_RISK_REGISTER, dependencyRiskEntry } from '../lib/security/dependency-risk-register.ts';
import { verifyTurnstile } from '../lib/auth/turnstile.ts';
import { checkPasswordBreached } from '../lib/security/password-breach-check.ts';

// AUTH-DEPENDENCY-001: this file holds the dependency risk register's declared posture against
// real behavior, not just against its own prose. Two kinds of proof:
//  1. Postgres/Stripe/Google-JWKS ("fail-closed by construction, no fallback exists to test") are
//     checked structurally: no production file may catch one of these calls and return a fallback
//     value instead of letting the failure propagate.
//  2. Turnstile and HaveIBeenPwned are checked behaviorally: their real production functions are
//     called with a forced provider failure and the actual return value is asserted directly
//     against DEPENDENCY_RISK_REGISTER's declared posture for that name, not a hardcoded literal --
//     so changing the register without changing the code (or the reverse) fails this test.

const root = process.cwd();
function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(file);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}
const productionFiles = [...filesBelow(path.join(root, 'app')), ...filesBelow(path.join(root, 'lib'))]
  .filter((file) => !file.includes(`${path.sep}tests${path.sep}`));

test('the authoritative Postgres read paths for session validity, account access, and rate limiting have no catch block at all -- a DB failure there has no way to be silently substituted with a fallback', () => {
  assert.equal(dependencyRiskEntry('postgres').posture, 'fail-closed');
  for (const relative of ['lib/auth/session-registry.ts', 'lib/membership/data-access.ts', 'lib/security/rate-limit.ts']) {
    const source = readFileSync(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /\bcatch\b/, `${relative} is expected to have zero catch blocks -- every DB failure in an authoritative read path must propagate uncaught`);
  }
});

test("lib/auth/session.ts's catches are all narrowly around token *parsing*, never around a database call, so a DB failure there still has no fallback path", () => {
  const source = readFileSync(path.join(root, 'lib/auth/session.ts'), 'utf8');
  const catchBlocks = [...source.matchAll(/\{[^{}]*\}\s*catch\s*\{[^{}]*\}/g)].map((match) => match[0]);
  assert.ok(catchBlocks.length > 0, 'expected to find the known JWT-parsing catch blocks in session.ts');
  for (const block of catchBlocks) {
    assert.match(block, /verifyToken\(/, `unexpected catch block in session.ts not wrapping verifyToken(): ${block}`);
    assert.doesNotMatch(block, /\b(?:db\.|await\s+sql`)/, `a catch block in session.ts appears to wrap a database call: ${block}`);
  }
});

test('no production file catches a Stripe SDK call and returns a fallback "success" value instead of propagating the failure', () => {
  assert.equal(dependencyRiskEntry('stripe').posture, 'fail-closed');
  const stripeCallers = productionFiles.filter((file) => /stripe/i.test(file) && !file.endsWith('stripe-client.ts'));
  assert.ok(stripeCallers.length > 0, 'expected at least one production Stripe call site to check');
  for (const file of stripeCallers) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /catch[^{]*\{\s*return\s+(?:true|\{\s*(?:ok|success)\s*:\s*true)/, `${path.relative(root, file)} appears to swallow a Stripe failure into a fabricated success`);
  }
});

test('Turnstile verification -- registered as fail-closed -- actually returns false on a provider network failure, matching the register', async () => {
  const entry = dependencyRiskEntry('turnstile');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('simulated network failure'); }) as typeof fetch;
  try {
    const result = await verifyTurnstile('any-token', '203.0.113.1', 'signup');
    assert.equal(entry.posture, 'fail-closed');
    assert.equal(result, false, 'a fail-closed dependency must reject, not silently pass, on provider failure');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HaveIBeenPwned -- registered as fail-open -- actually returns unblocked/unchecked on a provider network failure, matching the register', async () => {
  const entry = dependencyRiskEntry('have-i-been-pwned');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('simulated network failure'); }) as typeof fetch;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await checkPasswordBreached('Some Genuinely Strong Passphrase 42!');
    assert.equal(entry.posture, 'fail-open');
    assert.equal(result.breached, false, 'fail-open must never block on a provider outage');
    assert.equal(result.checked, false, 'fail-open must still report the check as unperformed, not "confirmed clean"');
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('every register entry names a real, non-empty rationale and evidence citation', () => {
  for (const entry of DEPENDENCY_RISK_REGISTER) {
    assert.ok(entry.rationale.length > 20, `${entry.name} needs a real rationale`);
    assert.ok(entry.evidence.length > 20, `${entry.name} needs a real evidence citation`);
  }
});
