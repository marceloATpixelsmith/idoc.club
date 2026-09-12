import { request } from '@playwright/test';
import Stripe from 'stripe';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { validateTestDatabaseUrl } from '../../lib/db/test-database-url';

export default async function globalSetup() {
  if (!process.env.STRIPE_E2E_EVIDENCE_DIR) throw new Error('STRIPE_E2E_EVIDENCE_DIR is required.');
  await mkdir(process.env.STRIPE_E2E_EVIDENCE_DIR, { recursive: true });
  const databaseUrl = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.POSTGRES_URL).toString();
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await sql.unsafe('drop schema if exists idoc cascade');
  await migrate(drizzle(sql), {
    migrationsFolder: resolve(process.cwd(), 'lib/db/migrations'),
    migrationsSchema: 'idoc',
    migrationsTable: '__drizzle_migrations',
  });
  await sql.end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
  const product = await stripe.products.retrieve(process.env.STRIPE_MEMBERSHIP_PRODUCT_ID as string);
  if (!product.active || product.deleted) throw new Error('Stripe E2E membership Product fixture is unavailable or inactive.');

  const context = await request.newContext();
  try {
    const response = await context.get(process.env.STRIPE_E2E_APP_URL as string);
    if (!response.ok()) throw new Error(`Stripe E2E application is not reachable (HTTP ${response.status()}).`);
  } finally {
    await context.dispose();
  }
}
