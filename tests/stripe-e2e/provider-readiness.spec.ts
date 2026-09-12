import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import Stripe from 'stripe';

const sql = postgres(process.env.TEST_DATABASE_URL as string, { max: 1 });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

test('provider readiness is proven by isolated test-mode Customer and Product objects', async () => {
  const rows = await sql<{ external_customer_id: string; fixture_key: string }[]>`
    select b.external_customer_id,u.email fixture_key
    from idoc.billing_accounts b
    join idoc.profiles p on p.id=b.profile_id
    join idoc.users u on u.id=p.user_id
    where u.email like 'stripe-e2e-%@example.test'
    order by u.email`;
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.external_customer_id)).size).toBe(2);

  for (const row of rows) {
    const customer = await stripe.customers.retrieve(row.external_customer_id);
    expect(customer.deleted).toBe(false);
    if (!customer.deleted) {
      expect(customer.livemode).toBe(false);
      expect(customer.metadata.fixture).toBe(row.fixture_key);
    }
  }

  const product = await stripe.products.retrieve(process.env.STRIPE_MEMBERSHIP_PRODUCT_ID as string);
  expect(product.deleted).toBe(false);
  if (!product.deleted) {
    expect(product.livemode).toBe(false);
    expect(product.active).toBe(true);
  }
});
