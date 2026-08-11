import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, emailVerificationTokens, users } from '@/lib/db/schema';
import { normalizeEmail } from './validation';

const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Returns a raw token exactly once so the notification layer can deliver it. */
export async function issueEmailVerification(userId: number, untrustedEmail: string) {
  const pendingEmail = normalizeEmail(untrustedEmail);
  const token = randomBytes(32).toString('base64url');
  await db.insert(emailVerificationTokens).values({
    expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS), pendingEmail,
    tokenHash: hashToken(token), userId,
  });
  return token;
}

export async function consumeEmailVerification(token: string): Promise<boolean> {
  if (token.length < 32 || token.length > 100) return false;
  return db.transaction(async (tx) => {
    const [record] = await tx.select().from(emailVerificationTokens).where(and(
      eq(emailVerificationTokens.tokenHash, hashToken(token)),
      isNull(emailVerificationTokens.consumedAt), gt(emailVerificationTokens.expiresAt, new Date()),
    )).limit(1);
    if (!record) return false;
    const now = new Date();
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, record.pendingEmail)).limit(1);
    if (existing && existing.id !== record.userId) return false;
    await tx.update(users).set({ email: record.pendingEmail, emailVerifiedAt: now, updatedAt: now }).where(eq(users.id, record.userId));
    await tx.update(emailVerificationTokens).set({ consumedAt: now }).where(eq(emailVerificationTokens.id, record.id));
    await tx.insert(auditLog).values({ actorId: record.userId, action: 'account.email.verified', entityId: String(record.userId), entityType: 'user' });
    return true;
  });
}
