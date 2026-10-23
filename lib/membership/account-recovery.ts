import 'server-only';
import { communicationHoldFields, communicationHoldTimestamp, memberCommunicationsDisabled, stagingAuthEmailsAllowed } from '@/lib/runtime/member-launch-hold';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { accountDeliveryOutbox, accountRequestLimits, accountTokens, auditLog, memberships, migrationMap, professionalRoles, profiles, users } from '@/lib/db/schema';
import { encryptDeliveryPayload } from '@/lib/security/encrypted-payload';
import { defaultTiming, equalizeAnonymousResponse, type TimingDependencies } from '@/lib/security/response-timing';
import { memberProfileSchema, normalizeEmail } from './validation';
import { checkPasswordBreached } from '@/lib/security/password-breach-check';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { notifyWebmasterOfBreachedPasswordAttempt } from '@/lib/notifications/breached-password-alert';
import { logError } from '@/lib/observability/logger';
import { dispatchQueuedEmailAfterResponse } from '@/lib/notifications/immediate-dispatch';
import { processAccountDeliveryBatch } from '@/lib/notifications/account-delivery';
import { processAuthSecurityNotificationBatch } from '@/lib/notifications/auth-security-delivery';

export type AccountTokenPurpose = 'migration_activation' | 'password_reset';
export type AccountLinkTransactionStage = 'after_token_insert' | 'after_outbox_insert' | 'before_commit';
const LIFETIME_MS = 60 * 60 * 1000;
const MINIMUM_RESPONSE_MS = 350;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function operationalFailureCategory(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('not configured') || message.includes('configuration')) return 'configuration';
  if (message.includes('encrypt') || message.includes('key')) return 'encryption';
  if (message.includes('connect') || message.includes('database')) return 'database';
  return 'operational';
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
    const allowed = await checkRateLimit(purpose, email, origin, now);
    const [user] = await db.select({ accountState: users.accountState, id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    const eligible = allowed && user && (purpose === 'password_reset' ? ['active', 'onboarding'].includes(user.accountState) : user.accountState === 'migrated_pending');
    if (eligible) {
      const rawToken = randomBytes(32).toString('base64url');
      const deliveryPayload = encryptDeliveryPayload({ email, token: rawToken });
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${user.id}, ${purpose === 'password_reset' ? 1 : 2})`);
        const [token] = await tx.insert(accountTokens).values({ expiresAt: new Date(now.getTime() + LIFETIME_MS), purpose, tokenHash: digest(rawToken), userId: user.id }).returning({ id: accountTokens.id });
        if (testFailureAt === 'after_token_insert') throw new Error('injected transaction failure');
        await tx.insert(accountDeliveryOutbox).values({ ...(stagingAuthEmailsAllowed() ? {} : communicationHoldFields()), ...deliveryPayload, messageId: stagingAuthEmailsAllowed() ? `staging-auth-${randomUUID()}` : randomUUID(), purpose, tokenId: token.id, userId: user.id });
        if (testFailureAt === 'after_outbox_insert') throw new Error('injected transaction failure');
        await tx.insert(auditLog).values({ action: `account.${purpose}.${memberCommunicationsDisabled() && !stagingAuthEmailsAllowed() ? 'delivery_blocked' : 'delivery_queued'}`, entityId: String(user.id), entityType: 'user' });
        if (testFailureAt === 'before_commit') throw new Error('injected transaction failure');
      });
      // Dispatch only after the token and outbox entry are committed.
      dispatchQueuedEmailAfterResponse(() => processAccountDeliveryBatch(1), 'account-delivery');
    }
  } catch (error) {
    // Do not include the identifier, origin, token, exception, or environment in logs.
    await logError('account_link_request_failed', {
      purpose,
      reason: operationalFailureCategory(error),
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
  return (await inspectMigrationActivationFoundation(tx, userId)).valid;
}

/** Same checks as validateMigrationActivationFoundation, and also reports whether the imported profile is complete. The legacy
 * import deliberately leaves required fields blank for members whose old record lacked them (docs/03); such an incomplete profile
 * is a valid foundation, but the member must finish it in onboarding, so activation moves them to `onboarding`, not `active`. */
export async function inspectMigrationActivationFoundation(tx: Tx, userId: number): Promise<{ valid: boolean; profileComplete: boolean }> {
  const invalid = { valid: false, profileComplete: false };
  const [user] = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.accountState !== 'migrated_pending') return invalid;
  const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!profile) { await tx.insert(auditLog).values({ action: 'account.migration_activation.reconciliation_required', entityId: String(userId), entityType: 'user', reason: 'missing_imported_profile' }); return invalid; }
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
  // An imported profile with blank required fields (never a fabricated value) is accepted when it still identifies the person
  // and carries at least one role; onboarding collects the rest.
  const incompleteButUsable = !importedProfile.success && profile.legacyWpUserId !== null
    && profile.firstName.trim() !== '' && profile.lastName.trim() !== '' && roles.length > 0;
  const foundationValid = (importedProfile.success || incompleteButUsable) && mappings.length === 1 && Boolean(entitlement)
    && Boolean(entitlement?.startsOn) && Boolean(entitlement?.validUntil)
    && ['active', 'grace', 'expired', 'complimentary', 'canceled'].includes(entitlement?.status ?? '');
  if (!foundationValid) {
    await tx.insert(auditLog).values({
      action: 'account.migration_activation.reconciliation_required',
      entityId: String(userId), entityType: 'user', reason: 'incomplete_import_foundation',
    });
  }
  return { valid: foundationValid, profileComplete: importedProfile.success };
}

/** Applies the activation effects after the caller has proven the identity. Password establishment
 * is optional because the canonical normal-login path may already have verified a usable imported
 * credential; the compatibility activation path still supplies a new password. */
async function applyMigrationActivationMutation(tx: Tx, userId: number, password: string | undefined, profileComplete: boolean): Promise<number | null> {
  const now = new Date();
  const passwordUpdate = password === undefined ? {} : { passwordHash: await hashPassword(password), passwordSetAt: now };
  const [claimed] = await tx.update(users)
    .set({ ...passwordUpdate, accountState: profileComplete ? 'active' : 'onboarding', emailVerifiedAt: now, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: now })
    .where(and(eq(users.id, userId), eq(users.accountState, 'migrated_pending')))
    .returning({ id: users.id, sessionVersion: users.sessionVersion });
  if (!claimed) return null;
  await tx.update(accountTokens).set({ consumedAt: now }).where(and(eq(accountTokens.userId, userId), eq(accountTokens.purpose, 'migration_activation'), isNull(accountTokens.consumedAt)));
  await tx.insert(auditLog).values({ actorId: userId, action: 'account.migration_activation.completed', entityId: String(userId), entityType: 'user', afterJson: { accountState: profileComplete ? 'active' : 'onboarding' } });
  // One-time welcome tour for a legacy member's first sign-in on the new site. The state claim above runs once per account and the
  // dedupe key backs it, so this can never send twice. Queued in the same transaction; a hold marks it dead-lettered like every other notice.
  await tx.execute(sql`insert into auth_security_notification_outbox(dead_lettered_at,last_error_code,user_id,kind,recipient_email,dedupe_key)
    select ${communicationHoldTimestamp()}::timestamptz,case when ${memberCommunicationsDisabled()} then 'member_launch_hold' else null end,id,'legacy_welcome',email,${`legacy-welcome:${userId}`} from users where id=${userId}
    on conflict (dedupe_key) where dedupe_key is not null do nothing`);
  return claimed.sessionVersion;
}

/** Normal password-first login boundary. The password has already been successfully verified and
 * email possession has already been proven by a consumed login OTP. Preserve the verified imported
 * credential while enforcing the same migration-foundation checks, conditional state claim, audit,
 * session invalidation, and outstanding-token invalidation as token-based activation. */
export async function finalizeMigratedAccountAfterVerifiedPassword(userId: number): Promise<{ status: 'invalid' } | { status: 'success'; sessionVersion: number }> {
  const result = await db.transaction(async (tx) => {
    const foundation = await inspectMigrationActivationFoundation(tx, userId);
    if (!foundation.valid) return { status: 'invalid' as const };
    // Activation itself increments the session version; the caller must carry that exact value into its guarded re-read.
    const sessionVersion = await applyMigrationActivationMutation(tx, userId, undefined, foundation.profileComplete);
    if (sessionVersion === null) return { status: 'invalid' as const };
    return { status: 'success' as const, sessionVersion };
  });
  if (result.status === 'success') dispatchQueuedEmailAfterResponse(() => processAuthSecurityNotificationBatch(1), 'account-delivery');
  return result;
}

/** Compatibility/support entry point for migrated accounts that do not have a usable imported
 * credential. This remains unlinked from normal sign-in and establishes a new password only after
 * the migration foundation and identity proof have been validated. */
export async function activateMigratedAccountByUserId(userId: number, password: string): Promise<{ status: 'invalid' | 'success' }> {
  const result = await db.transaction(async (tx): Promise<{ status: 'invalid' | 'success' }> => {
    const foundation = await inspectMigrationActivationFoundation(tx, userId);
    if (!foundation.valid) return { status: 'invalid' };
    if ((await applyMigrationActivationMutation(tx, userId, password, foundation.profileComplete)) === null) return { status: 'invalid' };
    return { status: 'success' };
  });
  if (result.status === 'success') dispatchQueuedEmailAfterResponse(() => processAuthSecurityNotificationBatch(1), 'account-delivery');
  return result;
}

export async function consumeAccountToken(rawToken: string, purpose: AccountTokenPurpose, password: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return { status: 'invalid' as const };
  // Checked before the transaction opens (never hold a database transaction open across an
  // external network call), and only after the token shape passes, but before any database read of
  // the real token record -- a wasted breach check against a garbage/expired token is harmless,
  // whereas an open transaction blocked on network I/O is not.
  if ((await checkPasswordBreached(password)).breached) {
    const [owner] = await db.select({ email: users.email }).from(accountTokens)
      .innerJoin(users, eq(users.id, accountTokens.userId))
      .where(and(eq(accountTokens.tokenHash, digest(rawToken)), eq(accountTokens.purpose, purpose), isNull(accountTokens.consumedAt), gt(accountTokens.expiresAt, new Date())))
      .limit(1);
    await notifyWebmasterOfBreachedPasswordAttempt({
      email: owner?.email,
      source: purpose === 'migration_activation' ? 'migration-activation' : 'password-reset-token',
    });
    return { status: 'breached_password' as const };
  }
  const result = await db.transaction(async (tx) => {
    const [record] = await tx.select().from(accountTokens).where(and(eq(accountTokens.tokenHash, digest(rawToken)), eq(accountTokens.purpose, purpose), isNull(accountTokens.consumedAt), gt(accountTokens.expiresAt, new Date()))).limit(1);
    if (!record) return { status: 'invalid' as const };
    if (purpose === 'migration_activation') {
      const foundation = await inspectMigrationActivationFoundation(tx, record.userId);
      if (!foundation.valid) return { status: 'invalid' as const };
      const [claimed] = await tx.update(accountTokens).set({ consumedAt: new Date() }).where(and(eq(accountTokens.id, record.id), isNull(accountTokens.consumedAt))).returning({ id: accountTokens.id });
      if (!claimed) return { status: 'invalid' as const };
      if ((await applyMigrationActivationMutation(tx, record.userId, password, foundation.profileComplete)) === null) return { status: 'invalid' as const };
      return { status: 'success' as const };
    }
    const [user] = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, record.userId)).limit(1);
    if (!user) return { status: 'invalid' as const };
    const [claimed] = await tx.update(accountTokens).set({ consumedAt: new Date() }).where(and(eq(accountTokens.id, record.id), isNull(accountTokens.consumedAt))).returning({ id: accountTokens.id });
    if (!claimed) return { status: 'invalid' as const };
    const now = new Date();
    await tx.update(users).set({ passwordHash: await hashPassword(password), passwordSetAt: now, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: now }).where(eq(users.id, record.userId));
    await tx.update(accountTokens).set({ consumedAt: now }).where(and(eq(accountTokens.userId, record.userId), eq(accountTokens.purpose, purpose), isNull(accountTokens.consumedAt)));
    await tx.insert(auditLog).values({ actorId: record.userId, action: `account.${purpose}.completed`, entityId: String(record.userId), entityType: 'user' });
    await tx.execute(sql`insert into auth_security_notification_outbox(dead_lettered_at,last_error_code,user_id,kind,recipient_email,dedupe_key)
      select ${communicationHoldTimestamp()}::timestamptz,case when ${memberCommunicationsDisabled()} then 'member_launch_hold' else null end,id,'password_reset_completed',email,${`password-reset-token:${record.id}`} from users where id=${record.userId}
      on conflict (dedupe_key) where dedupe_key is not null do nothing`);
    return { status: 'success' as const };
  });
  if (result.status === 'success') dispatchQueuedEmailAfterResponse(() => processAuthSecurityNotificationBatch(1), 'account-delivery');
  return result;
}
