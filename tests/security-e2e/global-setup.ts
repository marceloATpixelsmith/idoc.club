import { createCipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { validateTestDatabaseUrl } from '../../lib/db/test-database-url';
import { startGoogleMockIdp } from './google-mock-idp';

const STATES = ['member-a', 'member-b', 'onboarding', 'expired', 'suspended', 'administrator', 'super-administrator'] as const;
const AUTH_SECRET = process.env.AUTH_SECRET ?? 'security-e2e-only-auth-secret-32-bytes';

export const E2E_TOTP_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const E2E_RECOVERY_CODE = 'A1B2C3D4-E5F60718-192A3B4C-5D6E7F80';

// Mirrors lib/auth/mfa/totp.ts's encryptTotpSecret serialization exactly (keyId.iv.tag.ciphertext,
// AES-256-GCM, all base64url) without importing that module: Playwright 1.55's CommonJS-compatible
// transform for TypeScript global setup can load prebuilt ESM packages like jose, but not raw local
// app source, so this fixture-only encryption is duplicated in full rather than imported.
function encryptE2eTotpSecret(secret: string, keyId: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${keyId}.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

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
      const [profile] = await sql<{ id: number }[]>`
        insert into idoc.profiles(user_id,first_name,last_name,address_1,city,state_province,postal_code,country_code)
        values(${user.id},${name},'Security Fixture','1 Test Road','Test City','Test State','00000','DE')
        returning id`;
      await sql`insert into idoc.professional_roles(profile_id,role_type) values(${profile.id},'veterinarian')`;
      await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source)
        values(${profile.id},${name === 'expired' ? 'expired' : 'active'},'2025-01-01',${name === 'expired' ? '2025-12-31' : '2099-12-31'},'migration')`;
    }
    if (name === 'administrator' || name === 'super-administrator') {
      await sql`insert into idoc.application_roles(user_id,role,granted_by) values(${user.id},${name === 'administrator' ? 'administrator' : 'super_admin'},${user.id})`;
      // Mandatory MFA requires an active TOTP factor before any privileged flow (including WebAuthn
      // registration, which requires this as its fallback) can be exercised; the raw secret is fixed
      // and exported so specs can compute a valid current code without re-deriving it from the DB.
      const encryptedSecret = encryptE2eTotpSecret(E2E_TOTP_SECRET, 'e2e-v1', Buffer.from('uCl5FBBt6lgvPFEEQVFOOPNh7TVGKX8E4GEBoQuQerw', 'base64url'));
      await sql`insert into idoc.mfa_factors(factor_id,user_id,application_id,factor_type,status,encrypted_secret,encryption_key_id,activated_at)
        values(${randomUUID()},${user.id},'idoc.club','totp','active',${encryptedSecret},'e2e-v1',now())`;
      const recoveryDigest = createHmac('sha256', Buffer.from('zaoDYF2rFZXfbool4YgF40tqjFyibcoukUB8Q13y1Nc', 'base64url'))
        .update(E2E_RECOVERY_CODE.replace(/[^A-Z0-9]/g, ''), 'utf8').digest('base64url');
      await sql`insert into idoc.mfa_recovery_codes
        (recovery_code_id,user_id,application_id,generation_id,digest)
        values(${randomUUID()},${user.id},'idoc.club',${randomUUID()},${recoveryDigest})`;
    }
    const now = new Date();
    const sessionId = randomUUID();
    const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at)
      values(${sessionId},${user.id},${user.session_version},${now.toISOString()},${now.toISOString()},${expires.toISOString()})`;
    if (name === 'member-a') {
      const secondSessionId = randomUUID();
      const revokedSessionId = randomUUID();
      const expiredSessionId = randomUUID();
      await sql`insert into idoc.auth_sessions
        (session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at,revoked_at,revoke_reason)
        values
        (${secondSessionId},${user.id},${user.session_version},${now.toISOString()},${now.toISOString()},${expires.toISOString()},null,null),
        (${revokedSessionId},${user.id},${user.session_version},${now.toISOString()},${now.toISOString()},${expires.toISOString()},now(),'fixture-revoked'),
        (${expiredSessionId},${user.id},${user.session_version},${new Date(now.getTime() - 13 * 60 * 60 * 1000).toISOString()},${now.toISOString()},${new Date(now.getTime() - 60_000).toISOString()},null,null)`;
      await writeFile('.security-e2e/member-a-sessions.json', JSON.stringify({
        currentSessionId: sessionId, expiredSessionId, revokedSessionId, secondSessionId, userId: user.id,
      }));
    }
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
    const storageState = (domain: string) => JSON.stringify({
      cookies: [
        {
          name: 'idoc-session',
          value: token,
          domain,
          path: '/',
          expires: Math.floor(expires.getTime() / 1000),
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    });
    await writeFile(`.security-e2e/${name}.json`, storageState('127.0.0.1'));
    // A WebAuthn relying-party ID must be a valid domain, and Chromium rejects a bare IP address
    // (127.0.0.1) for that purpose even though it's an otherwise-trustworthy local origin. This
    // localhost-scoped variant exists only for specs that exercise a real WebAuthn ceremony; every
    // other spec keeps using the 127.0.0.1 fixtures above, unaffected.
    await writeFile(`.security-e2e/${name}-localhost.json`, storageState('localhost'));
  }
  await sql.end();

  // Started once here (not per-spec) so every spec file in the suite shares one running mock IdP,
  // the same way every spec shares one migrated database -- torn down in the global teardown below.
  const mockIdp = await startGoogleMockIdp();
  return async () => {
    await mockIdp.close();
  };
}
