import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { SignJWT } from 'jose';
import postgres from 'postgres';
import { validateTestDatabaseUrl } from '../../lib/db/test-database-url';

// These tests forge a validly-signed session JWT directly (matching tests/security-e2e/global-setup.ts's
// established idiom) but deliberately do NOT go through the normal login flow, so the resulting
// registry state is fully under this spec's control. This closes a gap the repository's own control
// inventory (docs/21 AUTH-SESSION-002/003) records: the shared Playwright global-setup fixture always
// creates a matching idoc.auth_sessions row for every forged token, so the "a syntactically valid,
// correctly signed JWT with no matching persisted row" and "a JWT whose claimed sessionVersion no
// longer matches the persisted row" scenarios were never previously exercised end-to-end.

const AUTH_SECRET = process.env.AUTH_SECRET ?? 'security-e2e-only-auth-secret-32-bytes';
const url = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.POSTGRES_URL).toString();

async function withDb<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

async function createUser(sql: ReturnType<typeof postgres>, email: string) {
  const [user] = await sql<{ id: number; session_version: number }[]>`
    insert into idoc.users(email,password_hash,email_verified_at,account_state)
    values(${email},'synthetic-not-a-usable-password',now(),'active')
    returning id,session_version`;
  return user;
}

async function forgeToken(input: { sessionId: string; userId: number; sessionVersion: number; now?: Date }) {
  const now = input.now ?? new Date();
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  return new SignJWT({
    version: 2,
    sessionId: input.sessionId,
    user: { id: input.userId, sessionVersion: input.sessionVersion },
    authenticatedAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    absoluteExpiresAt: expires.toISOString(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expires.getTime() / 1000))
    .sign(new TextEncoder().encode(AUTH_SECRET));
}

test('a syntactically valid, correctly signed JWT with no matching persisted registry row is rejected', async ({ browser }) => {
  const email = `session-replay-no-row-${randomUUID()}@security.example.test`;
  const token = await withDb(async (sql) => {
    const createdUser = await createUser(sql, email);
    // Deliberately never insert a matching idoc.auth_sessions row for this sessionId.
    return forgeToken({ sessionId: randomUUID(), userId: createdUser.id, sessionVersion: createdUser.session_version });
  });

  const context = await browser.newContext();
  await context.addCookies([{ name: 'idoc-session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax', secure: false }]);
  const identity = await context.request.get('/api/user');
  expect(await identity.json()).toBeNull();
  await context.close();
});

test('a JWT whose claimed sessionVersion no longer matches the persisted registry row is rejected, even though the row is otherwise active', async ({ browser }) => {
  const email = `session-replay-version-mismatch-${randomUUID()}@security.example.test`;
  const { token } = await withDb(async (sql) => {
    const user = await createUser(sql, email);
    const sessionId = randomUUID();
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    // The persisted row is registered at sessionVersion 0 (matching the freshly created user)...
    await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at)
      values(${sessionId},${user.id},0,${now.toISOString()},${now.toISOString()},${absoluteExpiresAt.toISOString()})`;
    // ...but the forged JWT claims a stale/different sessionVersion (as if issued before a password
    // change bumped the account's session_version, then replayed afterward).
    const signed = await forgeToken({ sessionId, userId: user.id, sessionVersion: 1, now });
    return { token: signed };
  });

  const context = await browser.newContext();
  await context.addCookies([{ name: 'idoc-session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax', secure: false }]);
  const identity = await context.request.get('/api/user');
  expect(await identity.json()).toBeNull();
  await context.close();
});

test('a JWT matching a directly-revoked registry row (never touched by the login/logout UI) is rejected', async ({ browser }) => {
  const email = `session-replay-direct-revoke-${randomUUID()}@security.example.test`;
  const { token } = await withDb(async (sql) => {
    const user = await createUser(sql, email);
    const sessionId = randomUUID();
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at,revoked_at,revoke_reason)
      values(${sessionId},${user.id},0,${now.toISOString()},${now.toISOString()},${absoluteExpiresAt.toISOString()},now(),'security-e2e-direct-revoke')`;
    return { token: await forgeToken({ sessionId, userId: user.id, sessionVersion: 0, now }) };
  });

  const identityContext = await browser.newContext();
  await identityContext.addCookies([{ name: 'idoc-session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax', secure: false }]);
  const identity = await identityContext.request.get('/api/user');
  expect(await identity.json()).toBeNull();
  await identityContext.close();

  // This is exactly the case app/(dashboard)/dashboard/layout.tsx's AuthorizationError handling
  // covers: the cookie is validly signed (middleware's verifyToken succeeds, so this never hits
  // middleware's own /sign-in redirect), but the session it names is revoked in the registry --
  // requireAccountAccess() only discovers that deeper, inside the dashboard layout itself. Before
  // that catch existed, this fell through uncaught into Next.js's generic error boundary instead
  // of a clean redirect; confirmed against real production crashes since 2026-08-27.
  for (const route of ['/dashboard', '/admin', '/onboarding']) {
    const protectedContext = await browser.newContext();
    await protectedContext.addCookies([{ name: 'idoc-session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax', secure: false }]);
    const response = await protectedContext.request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).toBe(307);

    // A validly-signed token reaches the deeper page boundary because middleware cannot see that
    // its registry row has been revoked. Dashboard/admin/onboarding must still provide a clean path
    // back to authentication instead of converting that stale session into a 404 or generic error.
    const location = response.headers().location!;
    expect(location.startsWith('http') ? new URL(location).pathname : location, route).toBe('/sign-in');
    await protectedContext.close();
  }
});

test('a validly-signed legacy-shaped cookie (the pre-retrofit starter-template session shape, under its old cookie name) never authenticates', async ({ browser }) => {
  // A signed JWT alone is never sufficient authentication authority. This forges the actual old
  // cookie shape and name the pre-persisted-session-registry codebase used -- a bare {user, iat}
  // payload (no version, no sessionId) under the cookie literally named 'session' -- and proves it
  // is rejected both at the session layer (/api/user) and at the middleware layer (/dashboard),
  // even though the signature is valid and the referenced user really exists.
  const email = `session-replay-legacy-cookie-${randomUUID()}@security.example.test`;
  const user = await withDb((sql) => createUser(sql, email));
  const legacyToken = await new SignJWT({ user: { id: user.id, sessionVersion: 0 } })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 12 * 60 * 60)
    .sign(new TextEncoder().encode(AUTH_SECRET));
  const legacyCookie = { name: 'session', value: legacyToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' as const, secure: false };

  // Two separate contexts, each freshly seeded with the legacy cookie: middleware.ts's own
  // response to the first request (finish()) sets a Set-Cookie deletion for the legacy cookie name,
  // which a shared context's cookie jar would apply before the second request ever went out --
  // silently turning the /dashboard check below into a test of an already-cookie-less request
  // rather than of whether a signed legacy cookie is rejected.
  const userContext = await browser.newContext();
  await userContext.addCookies([legacyCookie]);
  const identity = await userContext.request.get('/api/user');
  expect(await identity.json()).toBeNull();
  await userContext.close();

  const dashboardContext = await browser.newContext();
  await dashboardContext.addCookies([legacyCookie]);
  const dashboard = await dashboardContext.request.get('/dashboard', { maxRedirects: 0 });
  // NextResponse.redirect() defaults to a 307 (temporary redirect) status when none is passed
  // explicitly, which is what middleware.ts's sign-in redirects use.
  expect(dashboard.status()).toBe(307);
  expect(new URL(dashboard.headers().location!).pathname).toBe('/sign-in');
  await dashboardContext.close();
});

test('a genuinely valid, freshly registered session is accepted (positive control for the two rejection cases above)', async ({ browser }) => {
  const email = `session-replay-valid-control-${randomUUID()}@security.example.test`;
  const { token } = await withDb(async (sql) => {
    const user = await createUser(sql, email);
    const sessionId = randomUUID();
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at)
      values(${sessionId},${user.id},0,${now.toISOString()},${now.toISOString()},${absoluteExpiresAt.toISOString()})`;
    return { token: await forgeToken({ sessionId, userId: user.id, sessionVersion: 0, now }) };
  });

  const context = await browser.newContext();
  await context.addCookies([{ name: 'idoc-session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax', secure: false }]);
  const identity = await context.request.get('/api/user');
  expect((await identity.json()).email).toBe(email);
  await context.close();
});

test('an already-open dashboard redirects to sign-in when its session is revoked and the browser regains focus', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-b.json' });
  const page = await context.newPage();
  let sessionId: string | null = null;

  try {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard(?:\/membership)?$/);

    sessionId = await withDb(async (sql) => {
      const [session] = await sql<{ session_id: string }[]>`
        select s.session_id
        from idoc.auth_sessions s
        join idoc.users u on u.id = s.user_id
        where u.email = 'member-b@security.example.test'
          and s.revoked_at is null
        order by s.authenticated_at desc
        limit 1`;
      expect(session?.session_id).toBeTruthy();
      await sql`update idoc.auth_sessions
        set revoked_at = now(), revoke_reason = 'security-e2e-live-session-loss'
        where session_id = ${session.session_id}`;
      return session.session_id;
    });

    // No click and no page reload: this models a protected tab that stayed open while its session
    // became invalid, then the user returned to the browser. SWR's focus revalidation supplies the
    // same null identity that already flips the header to its logged-out menu; the guard must turn
    // that signal into an immediate navigation away from stale protected content.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page).toHaveURL(/\/sign-in$/);
  } finally {
    if (sessionId) {
      await withDb(async (sql) => {
        await sql`update idoc.auth_sessions
          set revoked_at = null, revoke_reason = null, last_activity_at = now()
          where session_id = ${sessionId}`;
      });
    }
    await context.close();
  }
});

