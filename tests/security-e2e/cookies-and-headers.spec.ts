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

test('the RFC 9116 vulnerability-disclosure policy is served at the well-known location', async ({ request }) => {
  const response = await request.get('/.well-known/security.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/plain');
  const body = await response.text();
  expect(body).toMatch(/^Contact: mailto:.+@.+$/m);
  expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T/m);
  expect(body).toMatch(/^Canonical: https?:\/\/.+\/\.well-known\/security\.txt$/m);
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
