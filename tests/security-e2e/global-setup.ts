import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { validateTestDatabaseUrl } from '../../lib/db/test-database-url';

const STATES = ['member-a', 'member-b', 'onboarding', 'expired', 'suspended', 'administrator', 'super-administrator'] as const;
const AUTH_SECRET = process.env.AUTH_SECRET ?? 'security-e2e-only-auth-secret-32-bytes';

export default async function globalSetup() {
  // Load jose through native dynamic import. Playwright 1.55 executes TypeScript global setup
  // through a CommonJS-compatible transform in this package, while jose is ESM-only.
  const { SignJWT } = await import('jose');
  const url = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.POSTGRES_URL).toString();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe('drop schema if exists idoc cascade');
  await migrate(drizzle(sql), {
    migrationsFolder: resolve(process.cwd(), 'lib/db/migrations'),
    migrationsSchema: 'idoc',
    migrationsTable: '__drizzle_migrations',
  });
  await mkdir('.security-e2e', { recursive: true });

  for (const name of STATES) {
    const accountState = name === 'onboarding' ? 'onboarding' : name === 'suspended' ? 'suspended' : 'active';
    const [user] = await sql<{ id: number; session_version: number }[]>`
      insert into idoc.users(email,password_hash,email_verified_at,account_state)
      values(${`${name}@security.example.test`},'synthetic-not-a-usable-password',now(),${accountState})
      returning id,session_version`;
    if (name !== 'onboarding') {
      const [profile] = await sql<{ id: number }[]>`insert into idoc.profiles(user_id,first_name,last_name,address_1,city,country_code)
        values(${user.id},${name},'Security Fixture','1 Test Road','Test City','DE') returning id`;
      await sql`insert into idoc.professional_roles(profile_id,role_type) values(${profile.id},'veterinarian')`;
      await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source)
        values(${profile.id},${name === 'expired' ? 'expired' : 'active'},'2025-01-01',${name === 'expired' ? '2025-12-31' : '2099-12-31'},'migration')`;
    }
    if (name === 'administrator' || name === 'super-administrator') {
      await sql`insert into idoc.application_roles(user_id,role,granted_by) values(${user.id},${name === 'administrator' ? 'administrator' : 'super_admin'},${user.id})`;
    }
    const now = new Date();
    const sessionId = randomUUID();
    const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at)
      values(${sessionId},${user.id},${user.session_version},${now.toISOString()},${now.toISOString()},${expires.toISOString()})`;
    const token = await new SignJWT({
      version: 2,
      sessionId,
      user: { id: user.id, sessionVersion: user.session_version },
      authenticatedAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
      absoluteExpiresAt: expires.toISOString(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(expires.getTime() / 1000))
      .sign(new TextEncoder().encode(AUTH_SECRET));
    await writeFile(
      `.security-e2e/${name}.json`,
      JSON.stringify({
        cookies: [
          {
            name: 'idoc-session',
            value: token,
            domain: '127.0.0.1',
            path: '/',
            expires: Math.floor(expires.getTime() / 1000),
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
          },
        ],
        origins: [],
      }),
    );
  }
  await sql.end();
}
