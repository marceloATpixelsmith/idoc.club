import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { accountDeliveryOutbox, accountRequestLimits, accountTokens, auditLog, billingAccounts, memberships, migrationMap, professionalRoles, profiles, users } from '@/lib/db/schema';
import { encryptDeliveryPayload } from '@/lib/security/encrypted-payload';
import { defaultTiming, equalizeAnonymousResponse, type TimingDependencies } from '@/lib/security/response-timing';
import { normalizeEmail } from './validation';

export type AccountTokenPurpose = 'migration_activation' | 'password_reset';
const LIFETIME_MS = 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 3;
const MINIMUM_RESPONSE_MS = 350;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function operationalFailureCategory(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('not configured') || message.includes('configuration')) return 'configuration';
  if (message.includes('encrypt') || message.includes('key')) return 'encryption';
  if (message.includes('connect') || message.includes('database')) return 'database';
  return 'operational';
}

async function takeAllowance(email: string, purpose: AccountTokenPurpose, origin: string, now: Date) {
  const secret = process.env.RATE_LIMIT_HASH_KEY;
  if (!secret) throw new Error('RATE_LIMIT_HASH_KEY is not configured.');
  const windowStartedAt = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const identifierHash = digest(`${secret}:account:${email}`);
  const originHash = digest(`${secret}:origin:${origin || 'unknown'}`);
  const rows = await db.execute<{ request_count: number }>(sql`
    insert into idoc.account_request_limits (purpose, identifier_hash, origin_hash, window_started_at)
    values (${purpose}, ${identifierHash}, ${originHash}, ${windowStartedAt})
    on conflict (purpose, identifier_hash, origin_hash, window_started_at)
    do update set request_count = idoc.account_request_limits.request_count + 1, updated_at = now()
    returning request_count
  `);
  return Boolean(rows[0] && rows[0].request_count <= MAX_REQUESTS);
}

/** Neutral anonymous boundary. It persists rate evidence and a deliverable token atomically. */
export async function requestAccountLink(untrustedEmail: string, purpose: AccountTokenPurpose, origin = 'unknown', timing: TimingDependencies = defaultTiming) {
  const startedAt = timing.now();
  try {
    const email = normalizeEmail(untrustedEmail);
    const now = new Date();
    const allowed = await takeAllowance(email, purpose, origin, now);
    const [user] = await db.select({ accountState: users.accountState, id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    const eligible = allowed && user && (purpose === 'password_reset' ? ['active', 'onboarding'].includes(user.accountState) : user.accountState === 'migrated_pending');
    if (eligible) {
      const rawToken = randomBytes(32).toString('base64url');
      const deliveryPayload = encryptDeliveryPayload({ email, token: rawToken });
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${user.id}, ${purpose === 'password_reset' ? 1 : 2})`);
        const [token] = await tx.insert(accountTokens).values({ expiresAt: new Date(now.getTime() + LIFETIME_MS), purpose, tokenHash: digest(rawToken), userId: user.id }).returning({ id: accountTokens.id });
        await tx.insert(accountDeliveryOutbox).values({ ...deliveryPayload, messageId: randomUUID(), purpose, tokenId: token.id, userId: user.id });
        await tx.insert(auditLog).values({ action: `account.${purpose}.delivery_queued`, entityId: String(user.id), entityType: 'user' });
      });
    }
  } catch (error) {
    // Do not include the identifier, origin, token, exception, or environment in logs.
    console.error('account_link_request_failed', {
      category: operationalFailureCategory(error),
      purpose,
    });
  } finally {
    await equalizeAnonymousResponse(startedAt, timing);
  }
}

export async function consumeAccountToken(rawToken: string, purpose: AccountTokenPurpose, password: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return { status: 'invalid' as const };
  return db.transaction(async (tx) => {
    const [record] = await tx.select().from(accountTokens).where(and(eq(accountTokens.tokenHash, digest(rawToken)), eq(accountTokens.purpose, purpose), isNull(accountTokens.consumedAt), gt(accountTokens.expiresAt, new Date()))).limit(1);
    if (!record) return { status: 'invalid' as const };
    const [user] = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, record.userId)).limit(1);
    if (!user || (purpose === 'migration_activation' && user.accountState !== 'migrated_pending')) return { status: 'invalid' as const };
    if (purpose === 'migration_activation') {
      const [profile] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, record.userId)).limit(1);
      if (!profile) { await tx.insert(auditLog).values({ action: 'account.migration_activation.reconciliation_required', entityId: String(record.userId), entityType: 'user', reason: 'missing_imported_profile' }); return { status: 'invalid' as const }; }
      const [roles, entitlement, mapping] = await Promise.all([
        tx.select({ id: professionalRoles.id }).from(professionalRoles).where(eq(professionalRoles.profileId, profile.id)).limit(1),
        tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.profileId, profile.id)).limit(1),
        tx.select({ id: migrationMap.id }).from(migrationMap).where(and(eq(migrationMap.newEntityId, String(record.userId)), eq(migrationMap.legacyType, 'wp_user'), eq(migrationMap.disposition, 'imported'))).limit(1),
      ]);
      if (!roles.length || !entitlement.length || !mapping.length) { await tx.insert(auditLog).values({ action: 'account.migration_activation.reconciliation_required', entityId: String(record.userId), entityType: 'user', reason: 'incomplete_import_foundation' }); return { status: 'invalid' as const }; }
      await tx.select({ id: billingAccounts.id }).from(billingAccounts).where(eq(billingAccounts.profileId, profile.id)).limit(1);
    }
    const [claimed] = await tx.update(accountTokens).set({ consumedAt: new Date() }).where(and(eq(accountTokens.id, record.id), isNull(accountTokens.consumedAt))).returning({ id: accountTokens.id });
    if (!claimed) return { status: 'invalid' as const };
    const now = new Date();
    await tx.update(users).set({ accountState: purpose === 'migration_activation' ? 'active' : user.accountState, emailVerifiedAt: purpose === 'migration_activation' ? now : undefined, passwordHash: await hashPassword(password), sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: now }).where(eq(users.id, record.userId));
    await tx.update(accountTokens).set({ consumedAt: now }).where(and(eq(accountTokens.userId, record.userId), eq(accountTokens.purpose, purpose), isNull(accountTokens.consumedAt)));
    await tx.insert(auditLog).values({ actorId: record.userId, action: `account.${purpose}.completed`, entityId: String(record.userId), entityType: 'user' });
    return { status: 'success' as const };
  });
}
