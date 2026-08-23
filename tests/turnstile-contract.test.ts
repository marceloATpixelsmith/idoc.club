import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyTurnstile } from '../lib/auth/turnstile.ts';

const originalFetch = globalThis.fetch;
const originalSecret = process.env.TURNSTILE_SECRET_KEY;
const originalBaseUrl = process.env.BASE_URL;

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

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = originalSecret;
  if (originalBaseUrl === undefined) delete process.env.BASE_URL;
  else process.env.BASE_URL = originalBaseUrl;
});

test('Turnstile accepts only success bound to the trusted hostname and expected action', async () => {
  configure();
  respond({ action: 'login', hostname: 'idoc.club', success: true });
  assert.equal(await verifyTurnstile('token', '203.0.113.10', 'login'), true);
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
