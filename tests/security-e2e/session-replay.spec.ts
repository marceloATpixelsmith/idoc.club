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

  const context = await browser.newContext();
  await context.addCookies([{ name: 'idoc-session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax', secure: false }]);
  const identity = await context.request.get('/api/user');
  expect(await identity.json()).toBeNull();
  await context.close();
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

  const context = await browser.newContext();
  await context.addCookies([{ name: 'session', value: legacyToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax', secure: false }]);

  const identity = await context.request.get('/api/user');
  expect(await identity.json()).toBeNull();

  const dashboard = await context.request.get('/dashboard', { maxRedirects: 0 });
  expect(dashboard.status()).toBe(302);
  expect(new URL(dashboard.headers().location!).pathname).toBe('/sign-in');

  await context.close();
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
