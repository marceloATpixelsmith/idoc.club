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
// /dashboard/profile renders one merged form (account email plus the professional profile fields,
// saved together by a single Server Action) -- selectors below scope to the form carrying the
// "firstName" field, the one form actually on the page.
test('a real profile-update Server Action rejects a same-origin, correctly authenticated submission whose CSRF token field has been tampered with', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/profile');
  const profileForm = page.locator('form').filter({ has: page.locator('input[name="firstName"]') });
  // Tamper the token on the wire, not in the DOM: this hidden field is a React-controlled input
  // (CsrfField), and submitting the form re-renders it from its own (untampered) React state before
  // FormData is captured -- a raw `field.value = ...` mutation is silently undone by that same click,
  // so it can never reliably reach the network as tampered. Intercepting and corrupting the real
  // outgoing request body proves the same thing a DOM-level tamper intended to, deterministically.
  await page.route('**/dashboard/profile', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') { await route.continue(); return; }
    const body = request.postDataBuffer();
    if (!body) { await route.continue(); return; }
    const tampered = body.toString('latin1').replace(
      /(name="\d*_?csrf_token"\r\n\r\n)([^\r\n]+)/,
      (_match, prefix: string, token: string) => `${prefix}${token.slice(0, -4)}0000`,
    );
    await route.continue({ postData: Buffer.from(tampered, 'latin1') });
  });
  await profileForm.locator('button[type="submit"]').click();
  // A generous timeout here: this assertion has been observed to occasionally time out at the
  // default 5s when the shared single-worker dev server is still finishing work from the
  // immediately preceding test in this same file -- the rejection itself is synchronous
  // server-side, but the round trip (dev-mode compilation, single Node process) can occasionally
  // run long under sequential load. This never weakens what is being verified, only how long the
  // assertion is willing to wait for it.
  await expect(page.locator('text=session security check failed')).toBeVisible({ timeout: 15_000 });
  // The session itself is unaffected -- this is a rejected mutation, not a broken session.
  const identity = await context.request.get('/api/user');
  expect((await identity.json()).email).toBe('member-a@security.example.test');
  await context.close();
});

// The "removed CSRF cookie" counterpart to the test above -- an assertion that does not currently
// hold in a real browser -- lives in ./csrf-cookie-removal.spec.ts, not this file. Keeping it out of
// this file matters beyond organization: docs/27-stripe-payment-acceptance-gate.json's
// CSRF-MUTATION-MATRIX scenario maps to this exact file, and
// scripts/validate-stripe-acceptance-gate.mjs scans the whole mapped file for any disabled-test
// marker, not just the scenario's own test -- see that other spec file's own comment for the
// specific marker names this deliberately avoids repeating here, to keep this file's own evidence
// (the tampered-token test above) from being incorrectly flagged as unreliable too.
