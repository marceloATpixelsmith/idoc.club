import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

type SessionFixture = {
  currentSessionId: string;
  expiredSessionId: string;
  revokedSessionId: string;
  secondSessionId: string;
  userId: number;
};

async function sessionFixture() {
  return JSON.parse(await readFile('.security-e2e/member-a-sessions.json', 'utf8')) as SessionFixture;
}

test('logout revokes the registry session so a copied cookie cannot be replayed', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-b.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page.getByText('Welcome, member-b Security Fixture.')).toBeVisible();
  const [oldCookie] = await context.cookies('http://127.0.0.1:3100');

  await page.getByRole('button').filter({ has: page.locator('[data-slot="avatar"]') }).click();
  await page.getByText('Sign out').click();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');

  const replay = await browser.newContext();
  await replay.addCookies([oldCookie]);
  const response = await replay.request.get('/api/user');
  expect(await response.json()).toBeNull();
  await replay.close();
  await context.close();
});

test('account security renders and revokes only the signed-in member active sessions', async ({ browser }) => {
  const fixture = await sessionFixture();
  const databaseUrl = process.env.TEST_DATABASE_URL;
  expect(databaseUrl).toBeTruthy();
  const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/security');

  const sessionCards = page.getByText(/^(Current|Another) session$/);
  await expect(sessionCards).toHaveCount(2);
  await expect(page.getByText('Current session')).toBeVisible();
  await expect(page.getByText('Another session')).toBeVisible();
  const body = await page.locator('body').innerText();
  expect(body).not.toContain(fixture.currentSessionId);
  expect(body).not.toContain(fixture.secondSessionId);
  expect(body).not.toContain(fixture.revokedSessionId);
  expect(body).not.toContain(fixture.expiredSessionId);
  expect(body).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  await expect(page.getByText('Device and location details are not collected.')).toBeVisible();

  await page.locator('form', { has: page.getByRole('button', { name: 'Log out this session' }) })
    .evaluate((form, forgedUserId) => {
      for (const [name, value] of [['userId', forgedUserId], ['sessionOwnerId', forgedUserId]]) {
        const input = document.createElement('input');
        input.name = name;
        input.value = value;
        form.append(input);
      }
    }, '999999');
  await page.getByRole('button', { name: 'Log out this session' }).click();
  await expect(page.getByText('That session has been logged out.')).toBeVisible();
  const [revoked] = await sql<{ revoked_at: Date | null; revoke_reason: string | null }[]>`
    select revoked_at,revoke_reason from idoc.auth_sessions where session_id=${fixture.secondSessionId}`;
  expect(revoked.revoked_at).not.toBeNull();
  expect(revoked.revoke_reason).toBe('member-security-session-signout');
  const identity = await context.request.get('/api/user');
  expect((await identity.json()).id).toBe(fixture.userId);

  const [other] = await sql<{ id: number; session_id: string }[]>`
    select u.id,s.session_id from idoc.users u join idoc.auth_sessions s on s.user_id=u.id
    where u.id<>${fixture.userId} and s.revoked_at is null limit 1`;
  const crossUserProbeId = crypto.randomUUID();
  await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at)
    values(${crossUserProbeId},${fixture.userId},0,now(),now(),now()+interval '12 hours')`;
  await page.reload();
  const revokeForm = page.locator('form', { has: page.getByRole('button', { name: 'Log out this session' }) }).first();
  await revokeForm.locator('input[name="sessionId"]').evaluate((input, sessionId) => {
    (input as HTMLInputElement).value = sessionId;
  }, other.session_id);
  await revokeForm.evaluate((form, forgedUserId) => {
    const input = document.createElement('input');
    input.name = 'userId';
    input.value = forgedUserId;
    form.append(input);
  }, String(other.id));
  await revokeForm.getByRole('button', { name: 'Log out this session' }).click();
  expect((await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions
    where session_id=${other.session_id} and revoked_at is null`)[0].count).toBe(1);

  const extraIds = [crypto.randomUUID(), crypto.randomUUID()];
  await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at)
    values(${extraIds[0]},${fixture.userId},0,now(),now(),now()+interval '12 hours'),
      (${extraIds[1]},${fixture.userId},0,now(),now(),now()+interval '12 hours')`;
  await page.reload();
  await expect(page.getByText('Another session')).toHaveCount(3);
  await page.getByRole('button', { name: 'Log out other sessions' }).click();
  await expect(page.getByText('Your other sessions have been logged out.')).toBeVisible();
  expect((await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions where user_id=${fixture.userId}
    and revoked_at is null and absolute_expires_at>now()`)[0].count).toBe(1);
  expect((await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions where session_id=${fixture.currentSessionId}
    and revoked_at is null`)[0].count).toBe(1);
  expect((await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions where session_id=${other.session_id}
    and revoked_at is null`)[0].count).toBe(1);
  await sql.end();
  await context.close();
});
