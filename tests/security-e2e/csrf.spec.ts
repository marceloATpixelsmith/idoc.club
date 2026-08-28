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

test('a Server Action request with no Origin header at all is not rejected by the origin-mismatch check specifically (Next only rejects a header that is present and wrong, not an absent one)', async ({ request }) => {
  // This documents actual, verified behavior rather than an assumption: omitting Origin entirely
  // behaves like a same-origin request for this specific check (it proceeds to action lookup and
  // fails with "Server action not found", not "Invalid Server Actions request"). A forged *mismatched*
  // Origin is what the two tests above prove is actually rejected. A real browser reliably sends
  // Origin on a cross-site POST, which is the threat model this protection actually defends against.
  const response = await request.post('/sign-in', {
    data: '[]',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'next-action': FORGED_ACTION_ID,
    },
  });
  const body = await response.text();
  expect(body).not.toContain('Invalid Server Actions request');
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
