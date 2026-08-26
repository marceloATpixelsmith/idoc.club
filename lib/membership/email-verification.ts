import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, billingAccounts, emailVerificationTokens, notificationOutbox, profiles, users } from '@/lib/db/schema';
import { sendTransactionalEmail } from '@/lib/notifications/mailchimp-transactional';
import { emailButton, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { updateStripeCustomerEmail } from '@/lib/payments/customer-email';
import { normalizeEmail } from './validation';
import { baseUrlForServer } from '@/lib/runtime/configuration';

const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function issueEmailVerification(userId: number, untrustedEmail: string) {
  const pendingEmail = normalizeEmail(untrustedEmail);
  const token = randomBytes(32).toString('base64url');
  await db.update(emailVerificationTokens).set({ consumedAt: new Date() }).where(and(
    eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.consumedAt),
  ));
  await db.insert(emailVerificationTokens).values({
    expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS), pendingEmail,
    tokenHash: hashToken(token), userId,
  });
  const baseUrl = new URL(baseUrlForServer());
  baseUrl.pathname = '/verify-email';
  baseUrl.searchParams.set('token', token);
  try {
    await sendTransactionalEmail({
      html: renderTransactionalEmail({
        bodyHtml: `<p>Confirm this is your new email address for your IDOC account.</p>${emailButton(baseUrl.toString(), 'Verify email')}`,
        footerNote: 'If you did not request this change, you can safely ignore this email.',
        heading: 'Verify your email address',
      }),
      subject: 'Verify your IDOC email address', to: pendingEmail,
    });
    return { delivered: true };
  } catch {
    //THE TOKEN REMAINS VALID SO A MEMBER CAN REQUEST A NEW DELIVERY.
    return { delivered: false };
  }
}

export type VerificationResult = { status: 'invalid' } | { status: 'verified'; userId: number };

export async function consumeEmailVerification(token: string): Promise<VerificationResult> {
  if (token.length < 32 || token.length > 100) return { status: 'invalid' };
  const result = await db.transaction(async (tx): Promise<VerificationResult & { customerId?: string; email?: string; profileId?: number }> => {
    const [record] = await tx.select().from(emailVerificationTokens).where(and(
      eq(emailVerificationTokens.tokenHash, hashToken(token)),
      isNull(emailVerificationTokens.consumedAt), gt(emailVerificationTokens.expiresAt, new Date()),
    )).limit(1);
    if (!record) return { status: 'invalid' };
    const now = new Date();
    const [claimed] = await tx.update(emailVerificationTokens).set({ consumedAt: now }).where(and(
      eq(emailVerificationTokens.id, record.id), isNull(emailVerificationTokens.consumedAt),
    )).returning({ id: emailVerificationTokens.id });
    if (!claimed) return { status: 'invalid' };
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, record.pendingEmail)).limit(1);
    if (existing && existing.id !== record.userId) return { status: 'invalid' };
    const [profile] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, record.userId)).limit(1);
    const [billing] = profile ? await tx.select({ externalCustomerId: billingAccounts.externalCustomerId }).from(billingAccounts).where(eq(billingAccounts.profileId, profile.id)).limit(1) : [];
    await tx.update(users).set({
      accountState: profile ? 'active' : 'onboarding',
      email: record.pendingEmail,
      emailVerifiedAt: now,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: now,
    }).where(eq(users.id, record.userId));
    if (billing?.externalCustomerId && profile) {
      await tx.insert(notificationOutbox).values({
        kind: 'stripe.customer_email_sync',
        payload: { customerId: billing.externalCustomerId, email: record.pendingEmail },
        profileId: profile.id,
      });
    }
    await tx.insert(auditLog).values({ actorId: record.userId, action: 'account.email.verified', entityId: String(record.userId), entityType: 'user' });
    return { customerId: billing?.externalCustomerId, email: record.pendingEmail, profileId: profile?.id, status: 'verified', userId: record.userId };
  });
  if (result.status === 'verified' && result.customerId && result.email && result.profileId) {
    try {
      await updateStripeCustomerEmail(result.customerId, result.email);
      await db.update(notificationOutbox).set({ sentAt: new Date() }).where(and(
        eq(notificationOutbox.kind, 'stripe.customer_email_sync'),
        eq(notificationOutbox.profileId, result.profileId),
      ));
    } catch {
      //THE OUTBOX RECORD RETAINS THE JOB FOR A RETRYING WORKER.
    }
  }
  return result.status === 'verified' ? { status: 'verified', userId: result.userId } : result;
}
