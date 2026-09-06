import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { validateTestDatabaseUrl } from '../../lib/db/test-database-url';
import { GOOGLE_MOCK_IDP_URL } from './google-mock-idp';

// requireAccountAccess('profile') (behind /api/user) deliberately rejects onboarding-state accounts
// (see lib/membership/account-access.ts) -- exactly the state every account here is in, since no
// test completes the onboarding wizard -- so identity is verified with a direct, read-only database
// check instead, matching the established idiom in tests/security-e2e/session-replay.spec.ts.
const url = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.POSTGRES_URL).toString();
async function withDb<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

// The Google OAuth routes previously had zero real browser-level e2e coverage: every proof of their
// security properties (state replay, purpose-mismatch, the login/signup intent redirect) lived either
// in source-inspection tests (tests/google-oidc-adoption.test.ts) or in tests/google-oidc-transactions
// .integration.ts, which calls the store/reference functions directly in a bare Node process rather
// than through the real running app -- unlike every password-based auth flow, which this suite already
// drives end-to-end. Two real production bugs (a raw `Date` crashing the write-side driver call, and
// the inverse crash reading a raw `client` timestamp column back as a string, not a Date -- see
// lib/auth/google-oidc-store.ts) slipped past that integration test despite it calling the exact
// functions that crashed. This spec closes that gap: every test here drives the real
// /api/auth/google/start and /api/auth/google/callback routes, through the real dev server, against
// real Postgres, exercising googleOidcTransactionStore.create/consume exactly as production traffic
// does. Only the identity provider itself (Google's authorization/token/JWKS endpoints) is a mock
// (google-mock-idp.ts) -- everything else in the flow is the genuine application and database.

async function configureMockIdentity(identity: {
  sub: string;
  email: string;
  emailVerified?: boolean;
  name?: string | null;
}) {
  const response = await fetch(`${GOOGLE_MOCK_IDP_URL}/mock/configure`, {
    body: JSON.stringify(identity),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  expect(response.ok).toBe(true);
}

function freshIdentity() {
  const unique = randomUUID();
  return { email: `google-e2e-${unique}@security.example.test`, sub: `mock-google-subject-${unique}` };
}

// The app builds every redirect via `new URL(path, request.url)`, so the `Location` header it sends
// is always an absolute URL (observed in CI as `http://localhost:3100/...`, not the `127.0.0.1:3100`
// baseURL these requests are made against) -- only the path and query are what these tests actually
// assert on.
function pathAndQuery(location: string | undefined) {
  if (!location) return location;
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
}

test('a signup attempt with a fresh Google identity creates a new account and lands on dashboard onboarding', async ({ page }) => {
  const identity = freshIdentity();
  await configureMockIdentity(identity);

  await page.goto('/api/auth/google/start?intent=signup');
  await expect(page.locator('#continue')).toBeVisible();
  await page.click('#continue');
  await expect(page).toHaveURL(/\/dashboard$/);

  const users = await withDb((sql) => sql<{ id: number }[]>`select id from idoc.users where email = ${identity.email}`);
  expect(users).toHaveLength(1);
  const links = await withDb((sql) => sql<{ user_id: number }[]>`
    select user_id from idoc.external_identities where subject = ${identity.sub}`);
  expect(links).toHaveLength(1);
  expect(links[0].user_id).toBe(users[0].id);
});

test('a login attempt with an already-linked Google identity signs into the same account rather than creating a new one', async ({ browser }) => {
  const identity = freshIdentity();
  await configureMockIdentity(identity);

  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  await firstPage.goto('/api/auth/google/start?intent=signup');
  await firstPage.click('#continue');
  await expect(firstPage).toHaveURL(/\/dashboard$/);
  await firstContext.close();

  // A brand new browser context: nothing about this second sign-in reuses the first attempt's
  // session, only the fact that the same Google identity was already linked to an account.
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await configureMockIdentity(identity);
  await secondPage.goto('/api/auth/google/start?intent=login');
  await secondPage.click('#continue');
  // Still an onboarding-state account (nothing in this spec completes onboarding), so login also
  // lands on dashboard onboarding -- the behavioral proof that matters here is that no *second* account or
  // identity link was silently created for the same Google identity.
  await expect(secondPage).toHaveURL(/\/dashboard$/);
  await secondContext.close();

  const users = await withDb((sql) => sql<{ id: number }[]>`select id from idoc.users where email = ${identity.email}`);
  expect(users).toHaveLength(1);
  const links = await withDb((sql) => sql<{ user_id: number }[]>`
    select user_id from idoc.external_identities where subject = ${identity.sub}`);
  expect(links).toHaveLength(1);
});

test('callback rejects a missing, tampered, or state-mismatched binding cookie before consuming the transaction', async ({ browser }) => {
  const context = await browser.newContext();

  // No binding cookie at all -- e.g. an attacker linking straight to a crafted callback URL.
  const noCookie = await context.request.get('/api/auth/google/callback?state=attacker-supplied-state', { maxRedirects: 0 });
  expect(noCookie.status()).toBe(302);
  expect(pathAndQuery(noCookie.headers().location)).toBe('/sign-in?google=failed');

  // A real transaction, but the binding cookie's HMAC signature is tampered before the callback runs.
  const start = await context.request.get('/api/auth/google/start?intent=login', { maxRedirects: 0 });
  const state = new URL(start.headers().location!).searchParams.get('state')!;
  const cookies = await context.cookies();
  const bindingCookie = cookies.find((cookie) => cookie.name === 'idoc-google-oauth');
  expect(bindingCookie).toBeTruthy();
  await context.addCookies([{ ...bindingCookie!, value: `${state}.tampered-signature` }]);
  const tampered = await context.request.get(`/api/auth/google/callback?state=${state}`, { maxRedirects: 0 });
  expect(tampered.status()).toBe(302);
  expect(pathAndQuery(tampered.headers().location)).toBe('/sign-in?google=failed');

  // A validly-signed binding cookie, but bound to a different state than the one presented.
  await context.addCookies([bindingCookie!]);
  const mismatched = await context.request.get('/api/auth/google/callback?state=a-different-state-entirely', { maxRedirects: 0 });
  expect(mismatched.status()).toBe(302);
  expect(pathAndQuery(mismatched.headers().location)).toBe('/sign-in?google=failed');

  await context.close();
});

test('a consumed callback cannot be replayed against the live route', async ({ browser }) => {
  const identity = freshIdentity();
  await configureMockIdentity(identity);
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('/api/auth/google/start?intent=login');
  // The mock consent page's "Continue" link is itself the real app callback URL (code + state), set
  // by the mock IdP's own redirect_uri handling -- captured before clicking so it can be replayed
  // afterward, since page.url() only ever reflects the final destination after redirects settle.
  const replayUrl = await page.locator('#continue').getAttribute('href');
  expect(replayUrl).toBeTruthy();
  await page.click('#continue');
  await expect(page).toHaveURL(/\/dashboard$/);

  const replay = await context.request.get(replayUrl!, { maxRedirects: 0 });
  expect(replay.status()).toBe(302);
  expect(pathAndQuery(replay.headers().location)).toBe('/sign-in?google=failed');
  await context.close();
});

test('an existing password account is never auto-linked: a matching Google identity is sent to sign-in with link-required, regardless of starting intent', async ({ page }) => {
  // member-b is created in global-setup as an ordinary password account, never linked to Google.
  await configureMockIdentity({ email: 'member-b@security.example.test', sub: `mock-google-subject-${randomUUID()}` });

  await page.goto('/api/auth/google/start?intent=signup');
  await page.click('#continue');
  await expect(page).toHaveURL(/\/sign-in\?google=link-required$/);
});

test('a declined Google consent sends the user back to the page they started from: signup stays on signup, login stays on sign-in', async ({ browser }) => {
  // This is the original reported bug: a failed Google signup attempt used to always land on
  // /sign-in instead of staying on /sign-up. Exercised here through the real callback route with the
  // exact `error=access_denied` parameter Google sends when a user clicks "Cancel" on consent.
  const signupContext = await browser.newContext();
  const signupStart = await signupContext.request.get('/api/auth/google/start?intent=signup', { maxRedirects: 0 });
  const signupState = new URL(signupStart.headers().location!).searchParams.get('state')!;
  const signupCallback = await signupContext.request.get(
    `/api/auth/google/callback?state=${signupState}&error=access_denied`,
    { maxRedirects: 0 },
  );
  expect(signupCallback.status()).toBe(302);
  expect(pathAndQuery(signupCallback.headers().location)).toBe('/sign-up?google=failed');
  await signupContext.close();

  const loginContext = await browser.newContext();
  const loginStart = await loginContext.request.get('/api/auth/google/start?intent=login', { maxRedirects: 0 });
  const loginState = new URL(loginStart.headers().location!).searchParams.get('state')!;
  const loginCallback = await loginContext.request.get(
    `/api/auth/google/callback?state=${loginState}&error=access_denied`,
    { maxRedirects: 0 },
  );
  expect(loginCallback.status()).toBe(302);
  expect(pathAndQuery(loginCallback.headers().location)).toBe('/sign-in?google=failed');
  await loginContext.close();
});

// AUTH-OPERATIONS-005: "Provider and JWKS failures MUST fail authentication closed; bounded
// validated-key caching and one bounded unknown-key refresh may support rotation but MUST NOT
// bypass validation or expose raw provider failures." Every other test in this file signs its mock
// ID token with the mock IdP's original, long-cached signing key, so the app's own remote-JWKS cache
// (lib/auth/google-oidc-reference.ts's resolveGoogleJwks, a real jose createRemoteJWKSet) never has
// a reason to hit the network again -- it would pass even if /certs were completely broken. This
// test forces a *genuine* unknown-key refresh (a freshly rotated kid the app has never seen) at the
// exact moment /certs is failing, so the real production verification path has no choice but to
// actually attempt, and fail, the live fetch this control is about.
test('a real Google callback fails closed, without exposing any raw provider/JWKS error text, when the identity provider key endpoint is unreachable during an unknown-key refresh', async ({ page }) => {
  const identity = freshIdentity();
  await configureMockIdentity(identity);
  const rotateResponse = await fetch(`${GOOGLE_MOCK_IDP_URL}/mock/rotate-signing-key`, { method: 'POST' });
  expect(rotateResponse.ok).toBe(true);

  const setJwksMode = async (mode: 'ok' | 'broken') => {
    const response = await fetch(`${GOOGLE_MOCK_IDP_URL}/mock/jwks-mode`, {
      body: JSON.stringify({ mode }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(response.ok).toBe(true);
  };

  try {
    await setJwksMode('broken');
    await page.goto('/api/auth/google/start?intent=signup');
    await expect(page.locator('#continue')).toBeVisible();
    await page.click('#continue');
    await expect(page).toHaveURL(/\/sign-up\?google=failed$/);

    // Only the rendered, user-visible text -- not page.content()'s full HTML source. In dev mode that
    // source also carries Next.js's own RSC debug payload (arbitrary internal timing floats, module
    // ids, source paths) inside inert <script> tags, which can coincidentally contain a short digit
    // sequence like "503" with no relation to an actual leaked HTTP status. What this control cares
    // about is what a user could actually see, which innerText reflects without that false-positive
    // surface.
    const pageText = await page.locator('body').innerText();
    for (const rawProviderText of [
      'mock identity provider key endpoint unavailable', 'ECONNREFUSED', 'fetch failed',
      'JWKSNoMatchingKey', 'JWKSTimeout', 'JOSEError',
    ]) {
      expect(pageText).not.toContain(rawProviderText);
    }

    const users = await withDb((sql) => sql<{ id: number }[]>`select id from idoc.users where email = ${identity.email}`);
    expect(users).toHaveLength(0);
    const links = await withDb((sql) => sql<{ user_id: number }[]>`
      select user_id from idoc.external_identities where subject = ${identity.sub}`);
    expect(links).toHaveLength(0);
  } finally {
    // Restore the shared mock IdP for every other spec in this suite, regardless of outcome above.
    await setJwksMode('ok');
  }
});
