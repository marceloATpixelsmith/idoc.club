import { expect, test } from '@playwright/test';

test('browser security headers are present on public and sensitive responses', async ({ request }) => {
  for (const route of ['/sign-in', '/api/user']) {
    const response = await request.get(route);
    const headers = response.headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['strict-transport-security']).toContain('includeSubDomains');
  }
});

test('CSP uses a fresh framework script nonce and denies unapproved origins', async ({ request }) => {
  const first = await request.get('/sign-in');
  const second = await request.get('/sign-in');
  const firstPolicy = first.headers()['content-security-policy'];
  const secondPolicy = second.headers()['content-security-policy'];
  const firstNonce = firstPolicy.match(/'nonce-([^']+)'/)?.[1];
  const secondNonce = secondPolicy.match(/'nonce-([^']+)'/)?.[1];

  expect(firstNonce).toBeTruthy();
  expect(secondNonce).toBeTruthy();
  expect(firstNonce).not.toBe(secondNonce);
  expect(firstPolicy.match(/script-src[^;]+/)?.[0]).not.toContain("'unsafe-inline'");
  // The security E2E web server runs through `next dev --turbopack`, whose hot-update runtime needs
  // eval. The pure policy test separately proves that production omits this development-only token.
  expect(firstPolicy.match(/script-src[^;]+/)?.[0]).toContain("'unsafe-eval'");
  expect(firstPolicy).toContain("img-src 'self' data:");
  expect(firstPolicy).not.toContain('img-src https:');
  expect(firstPolicy).toContain("connect-src 'self' https://challenges.cloudflare.com");
  expect(firstPolicy).toContain('frame-src https://challenges.cloudflare.com');
  expect(firstPolicy).toContain("frame-ancestors 'none'");
  expect(firstPolicy).not.toContain('evil.example');

  const html = await first.text();
  const scriptNonces = [...html.matchAll(/<script[^>]+nonce="([^"]+)"/g)].map((match) => match[1]);
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((nonce) => nonce === firstNonce)).toBe(true);
});

test('only the onboarding form is granted browser geolocation; every other route still denies it', async ({ browser, request }) => {
  // An unauthenticated request to /onboarding redirects to /sign-in before ever reaching the
  // onboarding page itself, so its headers would just be /sign-in's -- this must authenticate as
  // the 'onboarding'-state fixture to actually observe the onboarding page's own response.
  const context = await browser.newContext({ storageState: '.security-e2e/onboarding.json' });
  const onboarding = await context.request.get('/onboarding');
  expect(onboarding.headers()['permissions-policy']).toContain('geolocation=(self)');
  await context.close();
  for (const route of ['/sign-in', '/api/user']) {
    const response = await request.get(route);
    expect(response.headers()['permissions-policy']).toContain('geolocation=()');
  }
});

test('session/auth API responses carry an explicit Cache-Control: no-store', async ({ request }) => {
  // AUTH-TRANSPORT-002: these two routes reflect the caller's own session/linked-identity state, so
  // a shared or browser cache must never be allowed to serve one visitor's response to another.
  for (const route of ['/api/user', '/api/auth/google/link/status']) {
    const response = await request.get(route);
    expect(response.headers()['cache-control']).toBe('no-store');
  }
});

test('the RFC 9116 vulnerability-disclosure policy is served at the well-known location', async ({ request }) => {
  const response = await request.get('/.well-known/security.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/plain');
  const body = await response.text();
  expect(body).toMatch(/^Contact: mailto:.+@.+$/m);
  expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T/m);
  expect(body).toMatch(/^Canonical: https?:\/\/.+\/\.well-known\/security\.txt$/m);
});

test('every response carries a fresh, server-generated x-request-id correlation header, ignoring any client-supplied value', async ({ request }) => {
  // AUTH-LOG-004: a lightweight substitute for a full APM/tracing vendor integration. middleware.ts
  // assigns this on every request and forwards it downstream so Server Components/Actions/Route
  // Handlers can tag log lines with it (lib/observability/request-id.ts) -- this proves the
  // client-visible half of that behaviorally, against the real running app. The matcher covers
  // /api/* routes too (not only pages), so an API route is exercised here as well.
  for (const route of ['/sign-in', '/api/user']) {
    const first = await request.get(route);
    const second = await request.get(route);
    const firstId = first.headers()['x-request-id'];
    const secondId = second.headers()['x-request-id'];
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);

    // A client-supplied x-request-id must never be reflected back -- correlation IDs are always
    // server-generated, so a client can never inject an arbitrary value into correlated log output.
    const spoofed = await request.get(route, { headers: { 'x-request-id': 'attacker-supplied-value' } });
    expect(spoofed.headers()['x-request-id']).not.toBe('attacker-supplied-value');
  }
});

test('persisted session cookie has the development transport contract', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const [cookie] = await context.cookies('http://127.0.0.1:3100');
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe('Lax');
  expect(cookie.path).toBe('/');
  expect(cookie.secure).toBe(false);
  const identity = await context.request.get('/api/user');
  expect((await identity.json()).email).toBe('member-a@security.example.test');
  await context.close();
});
