import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkPasswordBreached } from '../lib/security/password-breach-check.ts';

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

function sha1(value: string) {
  return createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();
}

test('a password whose suffix appears in the range response is reported breached', async () => {
  const password = 'correct horse battery staple';
  const suffix = sha1(password).slice(5);
  let requestedUrl = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = typeof input === 'string' ? input : input.toString();
    return new Response(`AAAA1111111111111111111111111111111:3\n${suffix}:42\nBBBB2222222222222222222222222222222:9`, { status: 200 });
  }) as typeof fetch;
  const result = await checkPasswordBreached(password);
  assert.deepEqual(result, { breached: true, checked: true });
  assert.equal(requestedUrl, `https://api.pwnedpasswords.com/range/${sha1(password).slice(0, 5)}`);
});

test('a password whose suffix is absent from the range response is reported not breached', async () => {
  globalThis.fetch = (async () => new Response('AAAA1111111111111111111111111111111:3', { status: 200 })) as typeof fetch;
  assert.deepEqual(await checkPasswordBreached('a-genuinely-unique-password-9284'), { breached: false, checked: true });
});

test('the suffix comparison is case-insensitive', async () => {
  const password = 'lowercase-suffix-check-9284';
  const suffix = sha1(password).slice(5).toLowerCase();
  globalThis.fetch = (async () => new Response(`${suffix}:1`, { status: 200 })) as typeof fetch;
  assert.equal((await checkPasswordBreached(password)).breached, true);
});

test('only a 5-character SHA-1 prefix ever leaves this server -- never the password, never the full hash', async () => {
  const password = 'never-sent-in-full-9284';
  let requestedUrl = '';
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = typeof input === 'string' ? input : input.toString();
    requestInit = init;
    return new Response('', { status: 200 });
  }) as typeof fetch;
  await checkPasswordBreached(password);
  assert.equal(requestedUrl.includes(password), false);
  assert.equal(requestedUrl.includes(sha1(password)), false);
  assert.equal(requestedUrl.endsWith(sha1(password).slice(0, 5)), true);
  assert.equal(JSON.stringify(requestInit ?? {}).includes(password), false);
});

test('the range API is called with the free, keyless, k-anonymity range endpoint', async () => {
  let requestedUrl = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = typeof input === 'string' ? input : input.toString();
    return new Response('', { status: 200 });
  }) as typeof fetch;
  await checkPasswordBreached('anything-9284');
  assert.match(requestedUrl, /^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/);
});

test('fails open (never blocks the caller) on a non-OK HTTP status, and reports the check as unusable', async () => {
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
  assert.deepEqual(await checkPasswordBreached('anything-9284'), { breached: false, checked: false });
});

test('fails open on a network failure/timeout, and reports the check as unusable', async () => {
  globalThis.fetch = (async () => { throw new Error('ETIMEDOUT: simulated network failure'); }) as typeof fetch;
  assert.deepEqual(await checkPasswordBreached('anything-9284'), { breached: false, checked: false });
});

test('fails open when the request is aborted (provider hangs past the request timeout)', async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  }) as typeof fetch;
  const before = Date.now();
  const result = await checkPasswordBreached('anything-9284');
  assert.deepEqual(result, { breached: false, checked: false });
  // Sanity bound: the internal timeout is a few seconds, not e.g. left to hang indefinitely.
  assert.ok(Date.now() - before < 10_000);
});
