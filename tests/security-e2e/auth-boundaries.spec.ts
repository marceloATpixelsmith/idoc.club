import { expect, test } from '@playwright/test';

test('anonymous identity and protected pages fail closed', async ({ request }) => {
  const identity = await request.get('/api/user');
  expect(identity.status()).toBe(200);
  expect(await identity.json()).toBeNull();
  for (const route of ['/dashboard', '/dashboard/profile', '/dashboard/security', '/admin']) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).not.toBe(200);
  }
});

test('pending-flow cookies are not interchangeable with a session', async ({ browser }) => {
  for (const name of ['idoc_pending_signup', 'idoc_pending_login', 'idoc_pending_password_reset', 'idoc_pending_mfa']) {
    const context = await browser.newContext();
    await context.addCookies([{ name, value: 'hostile-replay', domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax', secure: false }]);
    const response = await context.request.get('/api/user');
    expect(await response.json(), name).toBeNull();
    await context.close();
  }
});

test('account-state and role boundaries are enforced on direct requests', async ({ browser }) => {
  const cases = [
    ['onboarding', '/dashboard', true],
    ['onboarding', '/onboarding', false],
    ['suspended', '/dashboard', false],
    ['expired', '/dashboard', false],
    ['expired', '/pricing', true],
    ['member-a', '/admin', false],
    ['administrator', '/admin', true],
  ] as const;
  for (const [fixture, route, allowed] of cases) {
    const context = await browser.newContext({ storageState: `.security-e2e/${fixture}.json` });
    const response = await context.request.get(route, { maxRedirects: 0 });
    if (allowed) expect(response.status(), `${fixture} -> ${route}`).toBe(200);
    else expect(response.status(), `${fixture} -> ${route}`).not.toBe(200);
    await context.close();
  }
});

// A deep link to a later dashboard step must redirect (307) an onboarding-state account back to
// /dashboard, never crash: requireAccountAccess('profile')/('member') throws AuthorizationError for
// accountState 'onboarding' (only the 'onboarding' operation itself is allowed), and left uncaught
// that reaches Next.js's generic error boundary (500) instead -- the same bug class fixed at
// AUTH-AUTHZ-009 (dashboard/layout.tsx), AUTH-AUTHZ-010 (support pages), and AUTH-AUTHZ-011
// (membership/page.tsx, found live via LIVE-AUTH-008 deep-link testing: 'not 200' alone would not
// have caught a 500, so this asserts the redirect status explicitly).
test('an onboarding-state account is redirected, not crashed, off later dashboard steps', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/onboarding.json' });
  for (const route of ['/dashboard/membership', '/dashboard/profile', '/dashboard/security', '/dashboard/support']) {
    const response = await context.request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).toBe(307);
    expect(response.headers()['location'], route).toBe('/dashboard');
  }
  await context.close();
});
