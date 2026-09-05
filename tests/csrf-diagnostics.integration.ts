import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { issueCsrfToken, requireCsrfToken, requireCsrfTokenValue, CsrfError } from '../lib/security/csrf.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';

// Real production reports of unexplained, reproducible CSRF rejections (a multi-step recovery
// flow's final confirmation step, in particular) previously had no way to be diagnosed beyond
// re-reading lib/security/csrf.ts's logic and guessing which of its several distinct failure
// conditions actually fired. These tests prove each condition now logs a distinct, correct reason
// via the real production csrfEvidenceIsValid path (never a hand-duplicated copy), and that the
// secret token/candidate values themselves never appear in what gets logged.

Object.assign(process.env, {
  AUTH_SECRET: 'csrf-diagnostics-integration-secret-long-enough',
});

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
  clone() { const clone = new TestCookies(); for (const [name, value] of this.values) clone.set(name, value); return clone; }
}

let warnCalls: unknown[][] = [];
const originalWarn = console.warn;

beforeEach(() => {
  warnCalls = [];
  console.warn = (...args: unknown[]) => { warnCalls.push(args); };
});

test.after(() => { console.warn = originalWarn; });

function form(name: string, value: string): FormData {
  const data = new FormData();
  data.set(name, value);
  return data;
}

test('valid CSRF evidence logs nothing at all', async () => {
  const cookies = new TestCookies();
  const token = await withTestRequestCookies(cookies, () => issueCsrfToken(null));
  await withTestRequestCookies(cookies, () => requireCsrfToken(form('csrf_token', token), null));
  assert.deepEqual(warnCalls, []);
});

test('a missing cookie (never visited, or already expired) logs reason missing_cookie', async () => {
  const cookies = new TestCookies();
  await assert.rejects(
    withTestRequestCookies(cookies, () => requireCsrfToken(form('csrf_token', 'anything'), null)),
    CsrfError,
  );
  assert.equal(warnCalls.length, 1);
  const [event, meta] = warnCalls[0];
  assert.equal(event, 'csrf_validation_failed');
  assert.equal((meta as { reason: string }).reason, 'missing_cookie');
  assert.equal((meta as { expectedSessionPresent: boolean }).expectedSessionPresent, false);
});

test('a form with no csrf_token field at all logs reason missing_candidate', async () => {
  const cookies = new TestCookies();
  await withTestRequestCookies(cookies, () => issueCsrfToken(null));
  await assert.rejects(
    withTestRequestCookies(cookies, () => requireCsrfToken(new FormData(), null)),
    CsrfError,
  );
  assert.equal(warnCalls.length, 1);
  assert.equal((warnCalls[0][1] as { reason: string }).reason, 'missing_candidate');
});

test('a submitted value that does not match the current cookie logs reason value_mismatch, never the values themselves', async () => {
  const cookies = new TestCookies();
  const token = await withTestRequestCookies(cookies, () => issueCsrfToken(null));
  const wrongValue = 'completely-different-forged-value';
  await assert.rejects(
    withTestRequestCookies(cookies, () => requireCsrfToken(form('csrf_token', wrongValue), null)),
    CsrfError,
  );
  assert.equal(warnCalls.length, 1);
  const [, meta] = warnCalls[0];
  assert.equal((meta as { reason: string }).reason, 'value_mismatch');
  const logged = JSON.stringify(warnCalls[0]);
  assert.equal(logged.includes(token), false, 'the real cookie token must never be logged');
  assert.equal(logged.includes(wrongValue), false, 'the submitted candidate must never be logged');
});

test('a syntactically-matching but unsigned/forged cookie value logs reason invalid_token', async () => {
  const cookies = new TestCookies();
  const forged = 'not-a-real-signed-jwt';
  cookies.set('idoc-csrf', forged);
  await assert.rejects(
    withTestRequestCookies(cookies, () => requireCsrfToken(form('csrf_token', forged), null)),
    CsrfError,
  );
  assert.equal(warnCalls.length, 1);
  assert.equal((warnCalls[0][1] as { reason: string }).reason, 'invalid_token');
});

test('a token that verifies but was minted under a different session logs reason session_ref_mismatch, distinguishing which side actually had a session bound', async () => {
  const cookies = new TestCookies();
  const token = await withTestRequestCookies(cookies, () => issueCsrfToken('session-abc'));
  await assert.rejects(
    withTestRequestCookies(cookies, () => requireCsrfToken(form('csrf_token', token), 'session-xyz')),
    CsrfError,
  );
  assert.equal(warnCalls.length, 1);
  const [, meta] = warnCalls[0];
  assert.equal((meta as { reason: string }).reason, 'session_ref_mismatch');
  assert.equal((meta as { expectedSessionPresent: boolean }).expectedSessionPresent, true);
  assert.equal((meta as { tokenSessionPresent: boolean }).tokenSessionPresent, true);
});

test('an anonymously-minted token presented while a session was expected also logs session_ref_mismatch, with tokenSessionPresent false -- exactly the shape a shared-cookie-jar-across-tabs report would produce', async () => {
  const cookies = new TestCookies();
  const token = await withTestRequestCookies(cookies, () => issueCsrfToken(null));
  await assert.rejects(
    withTestRequestCookies(cookies, () => requireCsrfTokenValue(token, 'a-real-session-id')),
    CsrfError,
  );
  assert.equal(warnCalls.length, 1);
  const [, meta] = warnCalls[0];
  assert.equal((meta as { reason: string }).reason, 'session_ref_mismatch');
  assert.equal((meta as { expectedSessionPresent: boolean }).expectedSessionPresent, true);
  assert.equal((meta as { tokenSessionPresent: boolean }).tokenSessionPresent, false);
});
