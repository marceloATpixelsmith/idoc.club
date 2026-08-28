import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyTurnstile } from '../lib/auth/turnstile.ts';

// This file intentionally runs under the repository's raw Node test runner, so imported production
// modules must remain resolvable without the Next.js path-alias loader.
const originalFetch = globalThis.fetch;
const originalSecret = process.env.TURNSTILE_SECRET_KEY;
const originalBaseUrl = process.env.BASE_URL;
const originalNodeEnv = process.env.NODE_ENV;

function configure() {
  process.env.TURNSTILE_SECRET_KEY = 't'.repeat(32);
  process.env.BASE_URL = 'https://idoc.club';
}

function respond(payload: object) {
  globalThis.fetch = async () => new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

function respondWithStatus(status: number, body = '') {
  globalThis.fetch = async () => new Response(body, { status });
}

function respondWithMalformedBody() {
  globalThis.fetch = async () => new Response('not-json{{{', {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

function networkFailure() {
  globalThis.fetch = async () => { throw new Error('ETIMEDOUT: simulated network failure'); };
}

let fetchCallCount = 0;
function countingRespond(payload: object) {
  fetchCallCount = 0;
  globalThis.fetch = async () => {
    fetchCallCount += 1;
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' }, status: 200 });
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = originalSecret;
  if (originalBaseUrl === undefined) delete process.env.BASE_URL;
  else process.env.BASE_URL = originalBaseUrl;
  // NODE_ENV is typed read-only by @types/node; Object.assign bypasses that for this
  // test-only restoration (matching the existing precedent in tests/customer-portal.integration.ts).
  Object.assign(process.env, { NODE_ENV: originalNodeEnv ?? '' });
});

test('Turnstile accepts only success bound to the trusted hostname and expected action', async () => {
  configure();
  respond({ action: 'login', hostname: 'idoc.club', success: true });
  assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), true);
});

test('Turnstile rejects missing client evidence or trusted action context', async () => {
  configure();
  respond({ action: 'login', hostname: 'idoc.club', success: true });
  assert.equal(await verifyTurnstile('', '203.0.113.10', 'login'), false);
  assert.equal(await verifyTurnstile('token', '203.0.113.10', ''), false);
});

test('Turnstile rejects hostname mismatch', async () => {
  configure();
  respond({ action: 'login', hostname: 'evil.example', success: true });
  assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), false);
});

test('Turnstile rejects action mismatch', async () => {
  configure();
  respond({ action: 'signup', hostname: 'idoc.club', success: true });
  assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), false);
});

test('Turnstile rejects unsuccessful or incomplete provider responses', async () => {
  configure();
  for (const payload of [
    { action: 'login', hostname: 'idoc.club', success: false },
    { hostname: 'idoc.club', success: true },
    { action: 'login', success: true },
  ]) {
    respond(payload);
    assert.equal(await verifyTurnstile('token', undefined, 'login'), false);
  }
});

test('Turnstile fails closed when the provider request itself throws (network failure/timeout)', async () => {
  configure();
  networkFailure();
  assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), false);
});

test('Turnstile fails closed on a non-OK HTTP status from the provider, even with a well-formed body', async () => {
  configure();
  respondWithStatus(503, JSON.stringify({ action: 'login', hostname: 'idoc.club', success: true }));
  assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), false);
  respondWithStatus(500);
  assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), false);
});

test('Turnstile fails closed when the provider response body is not valid JSON', async () => {
  configure();
  respondWithMalformedBody();
  assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), false);
});

test('Turnstile fails closed without ever contacting the provider when the server secret is missing or malformed, in every NODE_ENV', async () => {
  for (const nodeEnv of ['development', 'test', 'production']) {
    Object.assign(process.env, { NODE_ENV: nodeEnv });
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.BASE_URL = 'https://idoc.club';
    countingRespond({ action: 'login', hostname: 'idoc.club', success: true });
    assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), false, `NODE_ENV=${nodeEnv}, missing secret`);
    assert.equal(fetchCallCount, 0, `NODE_ENV=${nodeEnv}: a missing secret must never reach the network`);

    process.env.TURNSTILE_SECRET_KEY = 'too-short';
    assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), false, `NODE_ENV=${nodeEnv}, undersized secret`);
    assert.equal(fetchCallCount, 0, `NODE_ENV=${nodeEnv}: an undersized secret must never reach the network`);
  }
});

test('Turnstile fails closed without ever contacting the provider when BASE_URL is missing, in every NODE_ENV', async () => {
  for (const nodeEnv of ['development', 'test', 'production']) {
    Object.assign(process.env, { NODE_ENV: nodeEnv });
    process.env.TURNSTILE_SECRET_KEY = 't'.repeat(32);
    delete process.env.BASE_URL;
    countingRespond({ action: 'login', hostname: 'idoc.club', success: true });
    assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), false, `NODE_ENV=${nodeEnv}`);
    assert.equal(fetchCallCount, 0, `NODE_ENV=${nodeEnv}: a missing BASE_URL must never reach the network`);
  }
});

test('there is no NODE_ENV-conditioned bypass: identical valid configuration behaves identically to production in development and test', async () => {
  for (const nodeEnv of ['development', 'test', 'production']) {
    Object.assign(process.env, { NODE_ENV: nodeEnv });
    configure();
    respond({ action: 'login', hostname: 'idoc.club', success: true });
    assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), true, `NODE_ENV=${nodeEnv}: valid response accepted`);
    respond({ action: 'login', hostname: 'idoc.club', success: false });
    assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), false, `NODE_ENV=${nodeEnv}: failed verification still rejected`);
  }
});

test('an "unknown" remote IP sentinel is never forwarded to the provider as though it were a real address', async () => {
  configure();
  let capturedBody = '';
  globalThis.fetch = async (_input, init) => {
    capturedBody = String((init as RequestInit)?.body ?? '');
    return new Response(JSON.stringify({ action: 'login', hostname: 'idoc.club', success: true }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  };
  await verifyTurnstile('token', 'unknown', 'login');
  assert.doesNotMatch(capturedBody, /remoteip/);
});
