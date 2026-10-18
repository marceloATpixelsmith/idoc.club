import { expect, test } from '@playwright/test';
import postgres from 'postgres';

test('the reconciliation page summarises findings by type and explains each type in plain language', async ({ browser }) => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  await sql`delete from idoc.reconciliation_findings`;
  await sql`insert into idoc.reconciliation_findings (kind, summary, external_customer_id, external_subscription_id, details) values
    ('orphaned_subscription', 'Stripe subscription sub_E2E1 is ''active'' but has no matching local record.', 'cus_E2E1', 'sub_E2E1', '{}'),
    ('unlinked_customer', 'Stripe Customer cus_E2E2 has no matching local billing account.', 'cus_E2E2', null, '{}'),
    ('unlinked_customer', 'Stripe Customer cus_E2E3 has no matching local billing account.', 'cus_E2E3', null, '{}'),
    ('dispute', 'A Stripe dispute requires operational review.', null, null, '{"disputeId":"dp_E2E4","paymentIntentId":"pi_E2E4"}')`;
  await sql`delete from idoc.reconciliation_runs`;
  await sql.end();

  const context = await browser.newContext({ storageState: '.security-e2e/super-administrator.json' });
  const page = await context.newPage();
  await page.goto('/admin/reconciliation');

  // Summary tab: totals, one card per type, most urgent first.
  await expect(page.getByRole('tab', { name: 'Summary' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByText('Total findings')).toBeVisible();
  await expect(page.getByText('Needs action', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Orphaned active Stripe subscription').first()).toBeVisible();
  await expect(page.getByText('Unlinked Stripe Customer').first()).toBeVisible();

  // With no completed scan, the page says so instead of claiming an all-clear.
  await expect(page.getByText('No scan has completed yet')).toBeVisible();
  await expect(page.getByText('Nothing to review')).toHaveCount(0);

  // The card links into the guide for that type.
  await page.getByRole('button', { name: 'What this means and what to do' }).first().click();
  await expect(page.getByRole('tab', { name: 'What each type means' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByText('Why it happens').first()).toBeVisible();
  await expect(page.getByText('What to do', { exact: true }).first()).toBeVisible();

  // The full table keeps every finding and shows the Stripe ID to search for.
  await page.getByRole('tab', { name: /All findings/ }).click();
  await expect(page.getByText('sub_E2E1').first()).toBeVisible();
  await expect(page.getByText('cus_E2E2').first()).toBeVisible();
  // Webhook findings keep their reference in details; the column still shows something to search for.
  await expect(page.getByText('pi_E2E4').first()).toBeVisible();

  // A Super Admin can run the scan on demand.
  await expect(page.getByRole('button', { name: 'Run scan now' })).toBeVisible();
  await context.close();
});
