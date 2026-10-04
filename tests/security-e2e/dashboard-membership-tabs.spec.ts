import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

test('an entitled member sees the dashboard menu and My Membership shows status, no paywall', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'My Membership' })).toBeVisible();
  await expect(page.getByText('Pay for your IDOC membership')).toHaveCount(0);
  await expect(page.getByText('Type', { exact: true })).toBeVisible();
  await expect(page.getByText('Payment history')).toBeVisible();
  for (const label of ['My Profile', 'My Security']) {
    await expect(page.getByRole('link', { name: label })).toBeVisible();
  }
  await context.close();
});

test('the Payment Method box only appears for a member with a Stripe billing account', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Membership', exact: true })).toBeVisible();
  // member-a has no Stripe billing account in this fixture set -- only tests/stripe-e2e's
  // acceptance-matrix spec, backed by real Stripe test-mode data, covers the box's actual contents
  // (card on file, the Update Payment Method button). Here it must not render at all, never an
  // empty/broken box.
  await expect(page.getByRole('heading', { name: 'Payment Method' })).toHaveCount(0);
  await context.close();
});

test('the renewal mode explains what the selected mode means in plain language', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  const automaticRadio = page.getByRole('radio', { name: 'Automatic' });
  await expect(automaticRadio).toBeVisible();
  if (await automaticRadio.isChecked()) {
    await expect(page.getByText(/your membership will automatically renew on/i)).toBeVisible();
  } else {
    await expect(page.getByText(/your membership will expire on/i)).toBeVisible();
  }
  await context.close();
});

test('member support lives under Contact and its thread returns to the ticket list', async ({ browser }) => {
  const { userId } = JSON.parse(await readFile('.security-e2e/member-a-sessions.json', 'utf8')) as { userId: number };
  const databaseUrl = process.env.TEST_DATABASE_URL;
  expect(databaseUrl).toBeTruthy();
  const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
  const [conversation] = await sql`insert into idoc.support_conversations(member_user_id,category,subject)
    values(${userId},'technical_support','Contact support regression fixture') returning id,public_id`;
  await sql`insert into idoc.support_messages(conversation_id,author_user_id,author_side,body,idempotency_key)
    values(${conversation.id},${userId},'member','Contact support regression fixture message',gen_random_uuid())`;

  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/contact');
  await expect(page.getByRole('heading', { name: 'Your conversations' })).toBeVisible();
  await expect(page.locator('nav[aria-label="My Dashboard"] a', { hasText: 'Support' })).toHaveCount(0);
  await page.getByRole('link', { name: /Contact support regression fixture/ }).click();
  await expect(page).toHaveURL(new RegExp(`/contact/${conversation.public_id}$`));
  const backLink = page.getByRole('link', { name: 'Back to My Support Tickets' });
  await expect(backLink).toHaveAttribute('href', '/contact');
  await backLink.click();
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.getByRole('heading', { name: 'Your conversations' })).toBeVisible();

  await context.close();
  await sql.end();
});

test('a not-yet-entitled member sees payment directly on My Membership, with no separate pricing page', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/expired.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard\/membership$/);
  await expect(page.getByRole('heading', { name: 'My Membership' })).toBeVisible();
  await expect(page.getByText('Pay for your IDOC membership')).toHaveCount(0);
  // Dashboard routes remain gated; public website pages remain public and do not become dashboard routes.
  await page.goto('/dashboard/profile');
  await expect(page).toHaveURL(/\/dashboard\/membership$/);
  // The legacy member-support URL now redirects to the Contact experience; the generic public form
  // remains available to this non-entitled account.
  await page.goto('/dashboard/support');
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.getByRole('heading', { name: 'Send a message' })).toBeVisible();
  // Available Seminars (not My Seminars) is the default landing view at bare /seminars for every
  // visitor, entitled or not (docs/08) -- this expired member reaches their own registration
  // history via the explicit My Seminars tab (?view=my), same as any other member.
  await page.goto('/seminars?view=my');
  await expect(page).toHaveURL(/\/seminars\?view=my$/);
  await expect(page.getByRole('heading', { name: 'My seminar registrations' })).toBeVisible();
  await context.close();
});

test('an administrator is never gated by membership payment status and can still reach dashboard security', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/administrator.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/security');
  await expect(page).toHaveURL(/\/dashboard\/security$/);
  await expect(page.getByText('Pay for your IDOC membership')).toHaveCount(0);
  await context.close();
});

test('an administrator with no member profile sees the dashboard menu and an honest "no profile" message, never the onboarding or paywall redirect', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/administrator-no-profile.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard\/membership$/);
  await expect(page.getByText('Pay for your IDOC membership')).toHaveCount(0);
  await expect(page.getByText('You have no member profile')).toBeVisible();
  for (const label of ['My Profile', 'My Security']) {
    await expect(page.getByRole('link', { name: label })).toBeVisible();
  }
  // Seminars is a public website page, not a dashboard tab.
  await page.goto('/seminars');
  await expect(page).toHaveURL(/\/seminars$/);
  await context.close();
});

test('My Profile merges the account email form with the professional profile form', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  // First/last name are the canonical name fields (docs/16) -- the redundant account-level "Name"
  // field was removed along with users.name, so account settings never maintain a second,
  // conflicting name value.
  await expect(page.getByLabel('First Name')).toBeVisible();
  await expect(page.getByLabel('Last Name')).toBeVisible();
  await expect(page.locator('label:has-text("Address 1")')).toBeVisible();
  await context.close();
});
