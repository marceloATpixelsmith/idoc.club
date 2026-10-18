import { expect, test } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { E2E_TOTP_SECRET } from './global-setup';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret: string, steps = 0) {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    accumulator = (accumulator << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) { bytes.push((accumulator >>> (bits - 8)) & 255); bits -= 8; }
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + steps));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = digest.at(-1)! & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}

// Names and emails are unique per call so a CI retry (which reuses the database) never collides with fixtures a failed attempt left behind.
async function seedMember(sql: postgres.Sql, base: string, state = 'active') {
  const first = `${base}${[...randomBytes(5)].map((byte) => String.fromCharCode(97 + (byte % 26))).join('')}`;
  const email = `${first.toLowerCase()}@dialogs.example.test`;
  const [user] = await sql<{ id: number }[]>`insert into idoc.users(email,password_hash,password_set_at,email_verified_at,account_state)
    values(${email},'synthetic-not-a-usable-password',now(),now(),${state}) returning id`;
  const [profile] = await sql<{ id: number }[]>`insert into idoc.profiles(user_id,first_name,last_name,address_1,city,state_province,postal_code,country_code)
    values(${user.id},${first},'Dialogfixture','1 Test Road','Test City','Test State','00000','DE') returning id`;
  await sql`insert into idoc.professional_roles(profile_id,role_type) values(${profile.id},'veterinarian')`;
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'active','2025-01-01','2099-12-31','migration')`;
  return { id: user.id, email, label: `Select ${first} Dialogfixture` };
}

test('archiving members needs no authenticator code and uses a branded dialog; deleting still asks for the code', async ({ browser }) => {
  test.setTimeout(120_000);
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  await sql`delete from idoc.account_request_limits where purpose like 'mfa_%'`;
  const keep = await seedMember(sql, 'Zarchiveone');
  const doomed = await seedMember(sql, 'Zdeleteone');
  const context = await browser.newContext({ storageState: '.security-e2e/administrator.json' });
  const page = await context.newPage();
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });

  await page.goto('/admin/members');
  const row = page.getByLabel(keep.label);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.check();

  // Archive: a branded confirmation, then it just happens: no authenticator prompt.
  await page.getByRole('button', { name: 'Archive selected' }).click();
  await expect(page.getByRole('heading', { name: 'Archive members' })).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect.poll(async () => (await sql`select account_state from idoc.users where id=${keep.id}`)[0].account_state, { timeout: 20_000 }).toBe('deleted');
  await expect(page.getByRole('heading', { name: 'Authenticator verification required' })).toHaveCount(0);

  // Delete: a branded confirmation, then the authenticator prompt.
  await page.reload();
  const doomedRow = page.getByLabel(doomed.label);
  await expect(doomedRow).toBeVisible({ timeout: 20_000 });
  await doomedRow.check();
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await expect(page.getByRole('heading', { name: 'Permanently delete members' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Authenticator verification required' })).toBeVisible();
  await page.getByLabel('Authenticator code').fill(totp(E2E_TOTP_SECRET));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect.poll(async () => (await sql`select count(*)::int as n from idoc.users where id=${doomed.id}`)[0].n, { timeout: 30_000 }).toBe(0);

  expect(nativeDialogs).toEqual([]);
  await sql.end();
  await context.close();
});

test('a refused delete explains itself in a branded dialog, not a browser alert', async ({ browser }) => {
  test.setTimeout(120_000);
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  await sql`delete from idoc.account_request_limits where purpose like 'mfa_%'`;
  const author = await seedMember(sql, 'Zauthorone');
  const [team] = await sql<{ id: number }[]>`insert into idoc.teams(name) values('Dialog fixture team') returning id`;
  await sql`insert into idoc.invitations(team_id,email,role,invited_by) values(${team.id},'invitee-dialogs@example.test','member',${author.id})`;
  const context = await browser.newContext({ storageState: '.security-e2e/administrator.json' });
  const page = await context.newPage();
  const nativeDialogs: string[] = [];
  page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });

  await page.goto('/admin/members');
  const row = page.getByLabel(author.label);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.check();
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByLabel('Authenticator code').fill(totp(E2E_TOTP_SECRET, 1));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  // The refusal text is covered by the member-lifecycle integration test; here it must be a branded dialog that can be dismissed.
  const notice = page.getByRole('dialog', { name: 'Could not delete' });
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText('Archive');
  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(notice).toBeHidden();
  expect(nativeDialogs).toEqual([]);
  await sql.end();
  await context.close();
});

test('a confirmation dialog can always be left: Escape and Cancel both close it and change nothing', async ({ browser }) => {
  test.setTimeout(90_000);
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  const member = await seedMember(sql, 'Zcancelone');
  const context = await browser.newContext({ storageState: '.security-e2e/administrator.json' });
  const page = await context.newPage();
  await page.goto('/admin/members');
  await page.getByLabel(member.label).check();

  const heading = page.getByRole('heading', { name: 'Archive members' });
  await page.getByRole('button', { name: 'Archive selected' }).click();
  await expect(heading).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(heading).toBeHidden();

  await page.getByRole('button', { name: 'Archive selected' }).click();
  await expect(heading).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(heading).toBeHidden();

  // The authenticator prompt can be left too: Escape cancels it without any code, and nothing is deleted.
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const authenticator = page.getByRole('heading', { name: 'Authenticator verification required' });
  await expect(authenticator).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(authenticator).toBeHidden({ timeout: 20_000 });
  await page.getByRole('dialog', { name: 'Could not delete' }).getByRole('button', { name: 'OK' }).click();
  expect((await sql`select count(*)::int as n from idoc.users where id=${member.id}`)[0].n).toBe(1);

  // Still selectable and untouched.
  await expect(page.getByRole('button', { name: 'Archive selected' })).toBeEnabled();
  expect((await sql`select account_state from idoc.users where id=${member.id}`)[0].account_state).toBe('active');
  await sql.end();
  await context.close();
});
