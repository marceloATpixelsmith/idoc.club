import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { accountTokens, auditLog, users } from '@/lib/db/schema';
import { hashPassword } from '@/lib/auth/session';
import { sendTransactionalEmail } from '@/lib/notifications/mailchimp-transactional';
import { normalizeEmail } from './validation';

export type AccountTokenPurpose = 'migration_activation' | 'password_reset';
const LIFETIME_MS = 60 * 60 * 1000;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export async function requestAccountLink(untrustedEmail: string, purpose: AccountTokenPurpose) {
  const email = normalizeEmail(untrustedEmail);
  const [user] = await db.select({ accountState: users.accountState, id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const eligible = user && (purpose === 'password_reset' ? user.accountState !== 'migrated_pending' : user.accountState === 'migrated_pending');
  if (!eligible) return;
  const rawToken = randomBytes(32).toString('base64url');
  await db.transaction(async (tx) => {
    await tx.update(accountTokens).set({ consumedAt: new Date() }).where(and(eq(accountTokens.userId, user.id), eq(accountTokens.purpose, purpose), isNull(accountTokens.consumedAt)));
    await tx.insert(accountTokens).values({ expiresAt: new Date(Date.now() + LIFETIME_MS), purpose, tokenHash: digest(rawToken), userId: user.id });
    await tx.insert(auditLog).values({ action: `account.${purpose}.requested`, entityId: String(user.id), entityType: 'user' });
  });
  const url = new URL(process.env.BASE_URL ?? 'http://localhost:3000');
  url.pathname = purpose === 'password_reset' ? '/reset-password' : '/activate';
  url.searchParams.set('token', rawToken);
  try {
    await sendTransactionalEmail({ html: `<p><a href="${url.toString()}">${purpose === 'password_reset' ? 'Reset your password' : 'Activate your imported IDOC account'}</a></p>`, subject: purpose === 'password_reset' ? 'Reset your IDOC password' : 'Activate your IDOC account', to: email });
  } catch {
    // A fresh request supersedes this still-safe token and retries delivery.
  }
}

export async function consumeAccountToken(rawToken: string, purpose: AccountTokenPurpose, password: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return { status: 'invalid' as const };
  return db.transaction(async (tx) => {
    const [record] = await tx.select().from(accountTokens).where(and(eq(accountTokens.tokenHash, digest(rawToken)), eq(accountTokens.purpose, purpose), isNull(accountTokens.consumedAt), gt(accountTokens.expiresAt, new Date()))).limit(1);
    if (!record) return { status: 'invalid' as const };
    const [user] = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, record.userId)).limit(1);
    if (!user || (purpose === 'migration_activation' && user.accountState !== 'migrated_pending')) return { status: 'invalid' as const };
    const [claimed] = await tx.update(accountTokens).set({ consumedAt: new Date() }).where(and(eq(accountTokens.id, record.id), isNull(accountTokens.consumedAt))).returning({ id: accountTokens.id });
    if (!claimed) return { status: 'invalid' as const };
    const now = new Date();
    await tx.update(users).set({ accountState: purpose === 'migration_activation' ? 'active' : user.accountState, emailVerifiedAt: purpose === 'migration_activation' ? now : undefined, passwordHash: await hashPassword(password), sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: now }).where(eq(users.id, record.userId));
    await tx.update(accountTokens).set({ consumedAt: now }).where(and(eq(accountTokens.userId, record.userId), isNull(accountTokens.consumedAt)));
    await tx.insert(auditLog).values({ actorId: record.userId, action: `account.${purpose}.completed`, entityId: String(record.userId), entityType: 'user' });
    return { status: 'success' as const };
  });
}
