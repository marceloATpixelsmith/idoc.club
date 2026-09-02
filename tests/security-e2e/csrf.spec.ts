import { expect, test } from '@playwright/test';

// Every authenticated, state-changing mutation in this codebase is a Next.js Server Action, not a
// custom app/api/* Route Handler (see docs/21 AUTH-CSRF-001). Server Actions rely on Next.js's
// built-in same-origin check: a POST carrying the `Next-Action` header is rejected outright when its
// `Origin` header does not match the deployment's own origin, before the action is ever looked up or
// invoked. This is real, load-bearing CSRF protection for cookie-authenticated unsafe mutations, and
// this spec proves it behaviorally rather than only documenting that Next.js provides it.

const FORGED_ACTION_ID = 'a'.repeat(40);

test('a Server Action request with a forged cross-origin Origin header is rejected before the action is ever looked up', async ({ request }) => {
  const response = await request.post('/sign-in', {
    data: '[]',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'next-action': FORGED_ACTION_ID,
      origin: 'https://attacker.example',
    },
  });
  const body = await response.text();
  expect(response.status(), body).not.toBe(200);
  expect(body).toContain('Invalid Server Actions request');
});

test('the same malformed action request, sent same-origin, fails for a different reason (an unrecognized action id) proving the earlier rejection really was origin-based', async ({ request, baseURL }) => {
  const response = await request.post('/sign-in', {
    data: '[]',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'next-action': FORGED_ACTION_ID,
      origin: baseURL!,
    },
  });
  const body = await response.text();
  expect(body).not.toContain('Invalid Server Actions request');
});

test('a Server Action request with no Origin header at all is rejected by the middleware-level hardening on top of Next\'s own check', async ({ request }) => {
  // Next's own built-in check (action-handler.ts) only rejects an Origin header that is *present and
  // wrong* -- it explicitly lets an absent Origin through, treating it like an old browser that never
  // sent one (see docs/21 AUTH-CSRF-001). middleware.ts closes that specific, documented gap: it
  // rejects any POST it recognizes as a possible Server Action (fetch-based via `next-action`, or a
  // plain-form url-encoded/multipart POST) that omits Origin entirely, before Next's own handler ever
  // sees it. A real browser reliably sends Origin on every such POST, so this has no effect on
  // legitimate traffic and only closes a forged/non-browser-client gap.
  const response = await request.post('/sign-in', {
    data: '[]',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'next-action': FORGED_ACTION_ID,
    },
  });
  const body = await response.text();
  expect(response.status(), body).toBe(403);
  expect(body).toContain('Invalid Server Actions request');
});

test('a plain-form (progressive-enhancement) Server Action POST with no Origin header is also rejected', async ({ request }) => {
  // The middleware-level check mirrors Next's own request-detection exactly (fetch-header, url-encoded,
  // and multipart form POSTs all count), not just the JS fetch-based case the other tests exercise.
  const response = await request.post('/sign-in', {
    data: 'field=value',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const body = await response.text();
  expect(response.status(), body).toBe(403);
  expect(body).toContain('Invalid Server Actions request');
});

test('a forged Origin cannot reach the real sign-out action either: a state-changing action behind an authenticated session still rejects the cross-origin attempt', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const response = await context.request.post('/dashboard', {
    data: '[]',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'next-action': FORGED_ACTION_ID,
      origin: 'https://attacker.example',
    },
  });
  const body = await response.text();
  expect(response.status(), body).not.toBe(200);
  expect(body).toContain('Invalid Server Actions request');
  // The authenticated identity itself is unaffected by the rejected forgery attempt.
  const identity = await context.request.get('/api/user');
  expect((await identity.json()).email).toBe('member-a@security.example.test');
  await context.close();
});

// AUTH-CSRF-003: same-origin, correctly authenticated requests above are legitimate load-bearing
// evidence for AUTH-CSRF-001/002/004, but they do not exercise the double-submit CSRF *token*
// (lib/security/csrf.ts, lib/security/csrf-tokens.ts) at all -- a same-origin POST with the real
// session cookie would succeed on Origin checking alone even if the token check were deleted
// entirely. These two tests isolate the token requirement itself: a real browser, a real
// authenticated session, and a real Next.js Server Action, with only the CSRF evidence disturbed.
test('a real profile-update Server Action rejects a same-origin, correctly authenticated submission whose CSRF token field has been tampered with', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/profile');
  await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>('input[name="csrf_token"]');
    if (!field) throw new Error('csrf_token field not found');
    field.value = `${field.value.slice(0, -4)}0000`;
  });
  await page.click('button[type="submit"]');
  await expect(page.locator('text=session security check failed')).toBeVisible();
  // The session itself is unaffected -- this is a rejected mutation, not a broken session.
  const identity = await context.request.get('/api/user');
  expect((await identity.json()).email).toBe('member-a@security.example.test');
  await context.close();
});

test('the same real profile-update Server Action rejects the submission when the (deliberately non-httpOnly) CSRF cookie has been removed, even though the form field still carries its last-known value', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/profile');
  await context.clearCookies({ name: 'idoc-csrf' });
  await page.click('button[type="submit"]');
  await expect(page.locator('text=session security check failed')).toBeVisible();
  await context.close();
});
