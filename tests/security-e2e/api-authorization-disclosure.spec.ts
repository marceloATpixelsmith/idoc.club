import { expect, test } from '@playwright/test';

// AUTH-API-004: app/api/user/route.ts is the production endpoint named in docs/23's evidence row --
// "denial -> generic null, 200, not error-shaped" -- and the one HTTP-addressable boundary in this
// application that reflects account/session state back to a caller. These specs drive the real
// running application (not a parallel test harness) to prove, at the actual HTTP layer, that no
// response ever discloses resource existence or an authorization-detail distinction: an anonymous
// caller, a caller in a disallowed account state, and a caller attempting to name a different
// account via request data are all indistinguishable except by the caller's own genuine identity.

test('an anonymous request and a disallowed-account-state session both receive the identical generic null, 200, never an error shape', async ({ browser }) => {
  const anonymous = await (await browser.newContext()).request.get('/api/user');
  expect(anonymous.status()).toBe(200);
  expect(await anonymous.json()).toBeNull();
  expect(anonymous.headers()['cache-control']).toBe('no-store');

  const context = await browser.newContext({ storageState: '.security-e2e/suspended.json' });
  const response = await context.request.get('/api/user');
  expect(response.status()).toBe(200);
  expect(await response.json()).toBeNull();
  expect(response.headers()['cache-control']).toBe('no-store');
  await context.close();
});

// AUTH-API-004 (docs/16): an onboarding account is not "disallowed" here the way suspended/deleted/
// unverified are -- My Membership onboarding now lives inside the dashboard layout, and that
// layout's header calls this same endpoint to render the account's own identity while onboarding is
// still in progress. It gets its real (profile-less) identity back, never the generic null.
test('an onboarding session receives its own generic identity, not the anonymous/disallowed null', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/onboarding.json' });
  const response = await context.request.get('/api/user');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).not.toBeNull();
  expect(body.email).toBe('onboarding@security.example.test');
  expect(body.firstName).toBeNull();
  expect(body.lastName).toBeNull();
  expect(response.headers()['cache-control']).toBe('no-store');
  await context.close();
});

test('an eligible session receives only its own identity, at the real HTTP layer, distinct account to distinct account', async ({ browser }) => {
  const memberAContext = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const memberBContext = await browser.newContext({ storageState: '.security-e2e/member-b.json' });

  const memberAResponse = await memberAContext.request.get('/api/user');
  const memberBResponse = await memberBContext.request.get('/api/user');
  expect(memberAResponse.status()).toBe(200);
  expect(memberBResponse.status()).toBe(200);

  const memberAIdentity = await memberAResponse.json();
  const memberBIdentity = await memberBResponse.json();
  expect(memberAIdentity.email).toBe('member-a@security.example.test');
  expect(memberBIdentity.email).toBe('member-b@security.example.test');
  expect(memberAIdentity.id).not.toBe(memberBIdentity.id);

  await memberAContext.close();
  await memberBContext.close();
});

test('naming a different account through query parameters or headers has no effect on the response: it always reflects only the caller\'s own server-derived session', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const baseline = await (await context.request.get('/api/user')).json();

  const attempts: { headers?: Record<string, string>; path: string }[] = [
    { path: '/api/user?userId=1&id=1&profileId=1' },
    { headers: { 'x-user-id': '1' }, path: '/api/user' },
    { headers: { 'x-forwarded-user': 'member-b@security.example.test' }, path: '/api/user' },
  ];
  for (const attempt of attempts) {
    const response = await context.request.get(attempt.path, { headers: attempt.headers });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(baseline);
  }

  await context.close();
});
