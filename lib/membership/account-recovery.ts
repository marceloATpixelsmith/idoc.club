import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { accountDeliveryOutbox, accountRequestLimits, accountTokens, auditLog, memberships, migrationMap, professionalRoles, profiles, users } from '@/lib/db/schema';
import { encryptDeliveryPayload } from '@/lib/security/encrypted-payload';
import { defaultTiming, equalizeAnonymousResponse, type TimingDependencies } from '@/lib/security/response-timing';
import { memberProfileSchema, normalizeEmail } from './validation';
import { rateLimitHashKeyForServer } from '@/lib/runtime/configuration';

export type AccountTokenPurpose = 'migration_activation' | 'password_reset';
export type AccountLinkTransactionStage = 'after_token_insert' | 'after_outbox_insert' | 'before_commit';
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
  const secret = rateLimitHashKeyForServer();
  const windowStartedAt = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const identifierHash = digest(`${secret}:account:${email}`);
  const originHash = digest(`${secret}:origin:${origin || 'unknown'}`);
  const rows = await db.execute<{ request_count: number }>(sql`
    insert into idoc.account_request_limits (purpose, identifier_hash, origin_hash, window_started_at)
    values (${purpose}, ${identifierHash}, ${originHash}, ${windowStartedAt.toISOString()})
    on conflict (purpose, identifier_hash, origin_hash, window_started_at)
    do update set request_count = idoc.account_request_limits.request_count + 1, updated_at = now()
    returning request_count
  `);
  return Boolean(rows[0] && rows[0].request_count <= MAX_REQUESTS);
}

/** Neutral anonymous boundary. It persists rate evidence and a deliverable token atomically. */
export async function requestAccountLink(
  untrustedEmail: string,
  purpose: AccountTokenPurpose,
  origin = 'unknown',
  timing: TimingDependencies = defaultTiming,
  testFailureAt?: AccountLinkTransactionStage,
) {
  if (testFailureAt && process.env.NODE_ENV !== 'test') throw new Error('Account-link failure injection is test-only.');
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
        if (testFailureAt === 'after_token_insert') throw new Error('injected transaction failure');
        await tx.insert(accountDeliveryOutbox).values({ ...deliveryPayload, messageId: randomUUID(), purpose, tokenId: token.id, userId: user.id });
        if (testFailureAt === 'after_outbox_insert') throw new Error('injected transaction failure');
        await tx.insert(auditLog).values({ action: `account.${purpose}.delivery_queued`, entityId: String(user.id), entityType: 'user' });
        if (testFailureAt === 'before_commit') throw new Error('injected transaction failure');
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Checks that a `migrated_pending` account's imported profile/roles/entitlement/mapping form a
 * complete foundation. Read-only except for the audit trail: an incomplete foundation is recorded
 * and left for reconciliation rather than mutating anything, so the caller's own claim (a token, or
 * an already-consumed OTP) is never spent on a foundation that can't yet be activated. */
export async function validateMigrationActivationFoundation(tx: Tx, userId: number): Promise<boolean> {
  const [user] = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.accountState !== 'migrated_pending') return false;
  const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!profile) { await tx.insert(auditLog).values({ action: 'account.migration_activation.reconciliation_required', entityId: String(userId), entityType: 'user', reason: 'missing_imported_profile' }); return false; }
  const [roles, entitlements, mappings] = await Promise.all([
    tx.select().from(professionalRoles).where(and(eq(professionalRoles.profileId, profile.id), isNull(professionalRoles.effectiveTo))),
    tx.select().from(memberships).where(eq(memberships.profileId, profile.id)),
    tx.select().from(migrationMap).where(and(eq(migrationMap.newEntityId, String(userId)), eq(migrationMap.legacyType, 'wp_user'), eq(migrationMap.disposition, 'imported'))),
  ]);
  const importedProfile = memberProfileSchema.safeParse({
    address1: profile.address1, address2: profile.address2 ?? undefined, city: profile.city,
    countryCode: profile.countryCode, firstName: profile.firstName, lastName: profile.lastName,
    postalCode: profile.postalCode, stateProvince: profile.stateProvince,
    roles: roles.map((role) => ({
      ...(role.roleType === 'veterinarian' ? {} : {
        feiId: role.feiId, idocRegion: role.idocRegion,
        nationalFederationCountryCode: role.nationalFederationCountryCode,
        officialStatuses: role.officialStatuses,
      }),
      ...(role.roleType === 'judge' ? { isTechnicalDelegate: role.isTechnicalDelegate } : {}),
      roleType: role.roleType,
    })),
  });
  const entitlement = entitlements.find(({ source }) => source === 'migration');
  const foundationValid = importedProfile.success && mappings.length === 1 && Boolean(entitlement)
    && Boolean(entitlement?.startsOn) && Boolean(entitlement?.validUntil)
    && ['active', 'grace', 'expired', 'complimentary', 'canceled'].includes(entitlement?.status ?? '');
  if (!foundationValid) {
    await tx.insert(auditLog).values({
      action: 'account.migration_activation.reconciliation_required',
      entityId: String(userId), entityType: 'user', reason: 'incomplete_import_foundation',
    });
  }
  return foundationValid;
}

/** Applies the activation effects after the caller has proven the identity. Password establishment
 * is optional because the canonical normal-login path may already have verified a usable imported
 * credential; the compatibility activation path still supplies a new password. */
async function applyMigrationActivationMutation(tx: Tx, userId: number, password?: string): Promise<boolean> {
  const now = new Date();
  const passwordUpdate = password === undefined ? {} : { passwordHash: await hashPassword(password) };
  const [claimed] = await tx.update(users)
    .set({ ...passwordUpdate, accountState: 'active', emailVerifiedAt: now, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: now })
    .where(and(eq(users.id, userId), eq(users.accountState, 'migrated_pending')))
    .returning({ id: users.id });
  if (!claimed) return false;
  await tx.update(accountTokens).set({ consumedAt: now }).where(and(eq(accountTokens.userId, userId), eq(accountTokens.purpose, 'migration_activation'), isNull(accountTokens.consumedAt)));
  await tx.insert(auditLog).values({ actorId: userId, action: 'account.migration_activation.completed', entityId: String(userId), entityType: 'user' });
  return true;
}

/** Normal password-first login boundary. The password has already been successfully verified and
 * email possession has already been proven by a consumed login OTP. Preserve the verified imported
 * credential while enforcing the same migration-foundation checks, conditional state claim, audit,
 * session invalidation, and outstanding-token invalidation as token-based activation. */
export async function finalizeMigratedAccountAfterVerifiedPassword(userId: number): Promise<{ status: 'invalid' | 'success' }> {
  return db.transaction(async (tx) => {
    if (!(await validateMigrationActivationFoundation(tx, userId))) return { status: 'invalid' };
    if (!(await applyMigrationActivationMutation(tx, userId))) return { status: 'invalid' };
    return { status: 'success' };
  });
}

/** Compatibility/support entry point for migrated accounts that do not have a usable imported
 * credential. This remains unlinked from normal sign-in and establishes a new password only after
 * the migration foundation and identity proof have been validated. */
export async function activateMigratedAccountByUserId(userId: number, password: string): Promise<{ status: 'invalid' | 'success' }> {
  return db.transaction(async (tx) => {
    if (!(await validateMigrationActivationFoundation(tx, userId))) return { status: 'invalid' };
    if (!(await applyMigrationActivationMutation(tx, userId, password))) return { status: 'invalid' };
    return { status: 'success' };
  });
}

export async function consumeAccountToken(rawToken: string, purpose: AccountTokenPurpose, password: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return { status: 'invalid' as const };
  return db.transaction(async (tx) => {
    const [record] = await tx.select().from(accountTokens).where(and(eq(accountTokens.tokenHash, digest(rawToken)), eq(accountTokens.purpose, purpose), isNull(accountTokens.consumedAt), gt(accountTokens.expiresAt, new Date()))).limit(1);
    if (!record) return { status: 'invalid' as const };
    if (purpose === 'migration_activation') {
      if (!(await validateMigrationActivationFoundation(tx, record.userId))) return { status: 'invalid' as const };
      const [claimed] = await tx.update(accountTokens).set({ consumedAt: new Date() }).where(and(eq(accountTokens.id, record.id), isNull(accountTokens.consumedAt))).returning({ id: accountTokens.id });
      if (!claimed) return { status: 'invalid' as const };
      if (!(await applyMigrationActivationMutation(tx, record.userId, password))) return { status: 'invalid' as const };
      return { status: 'success' as const };
    }
    const [user] = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, record.userId)).limit(1);
    if (!user) return { status: 'invalid' as const };
    const [claimed] = await tx.update(accountTokens).set({ consumedAt: new Date() }).where(and(eq(accountTokens.id, record.id), isNull(accountTokens.consumedAt))).returning({ id: accountTokens.id });
    if (!claimed) return { status: 'invalid' as const };
    const now = new Date();
    await tx.update(users).set({ passwordHash: await hashPassword(password), sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: now }).where(eq(users.id, record.userId));
    await tx.update(accountTokens).set({ consumedAt: now }).where(and(eq(accountTokens.userId, record.userId), eq(accountTokens.purpose, purpose), isNull(accountTokens.consumedAt)));
    await tx.insert(auditLog).values({ actorId: record.userId, action: `account.${purpose}.completed`, entityId: String(record.userId), entityType: 'user' });
    await tx.execute(sql`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
      select id,'password_reset_completed',email,${`password-reset-token:${record.id}`} from idoc.users where id=${record.userId}
      on conflict (dedupe_key) where dedupe_key is not null do nothing`);
    return { status: 'success' as const };
  });
}
