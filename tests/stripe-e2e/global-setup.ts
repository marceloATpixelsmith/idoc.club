import { request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { SignJWT } from 'jose';
import Stripe from 'stripe';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { resolve } from 'node:path';
import { validateTestDatabaseUrl } from '../../lib/db/test-database-url';

const AUTH_SECRET = process.env.AUTH_SECRET ?? 'stripe-e2e-only-auth-secret-32-bytes';

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
  const email = process.env.STRIPE_E2E_MEMBER_EMAIL;
  if (!email) throw new Error('STRIPE_E2E_MEMBER_EMAIL is required.');
  const [user] = await sql`insert into idoc.users(email,password_hash,email_verified_at,account_state)
    values(${email},'stripe-e2e-disabled-password',now(),'active')
    returning id,session_version`;
  const [profile] = await sql`insert into idoc.profiles(user_id,first_name,last_name,address_1,city,state_province,postal_code,country_code)
    values(${user.id},'Stripe','E2E','1 Test Road','Test City','Test State','00000','DE')
    returning id`;
  await sql`insert into idoc.professional_roles(profile_id,role_type) values(${profile.id},'veterinarian')`;
  const sessionId = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at)
    values(${sessionId},${user.id},${user.session_version},${now.toISOString()},${now.toISOString()},${expires.toISOString()})`;
  const token = await new SignJWT({ version: 2, sessionId, user: { id: user.id, sessionVersion: user.session_version }, authenticatedAt: now.toISOString(), lastActivityAt: now.toISOString(), absoluteExpiresAt: expires.toISOString() })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(Math.floor(expires.getTime() / 1000))
    .sign(new TextEncoder().encode(AUTH_SECRET));
  await mkdir('.stripe-e2e', { recursive: true });
  await writeFile('.stripe-e2e/member.json', JSON.stringify({ cookies: [{ name: 'idoc-session', value: token, domain: new URL(process.env.STRIPE_E2E_APP_URL).hostname, path: '/', expires: Math.floor(expires.getTime() / 1000), httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }));

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
  await sql.end();
}
