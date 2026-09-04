import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, billingAccounts, emailVerificationTokens, notificationOutbox, profiles, users } from '@/lib/db/schema';
import { sendTransactionalEmail } from '@/lib/notifications/brevo-transactional';
import { emailButton, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { updateStripeCustomerEmail } from '@/lib/payments/customer-email';
import { emailDisplayForm, normalizeEmail } from './validation';
import { baseUrlForServer } from '@/lib/runtime/configuration';

const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const recipientDiscriminator = (email: string) => createHash('sha256').update(email).digest('hex').slice(0, 16);

export async function issueEmailVerification(userId: number, untrustedEmail: string) {
  const pendingEmail = normalizeEmail(untrustedEmail);
  const pendingEmailDisplay = emailDisplayForm(untrustedEmail);
  const token = randomBytes(32).toString('base64url');
  await db.update(emailVerificationTokens).set({ consumedAt: new Date() }).where(and(
    eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.consumedAt),
  ));
  await db.insert(emailVerificationTokens).values({
    expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS), pendingEmail, pendingEmailDisplay,
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

type EmailVerificationTransactionResult = VerificationResult & { customerId?: string; email?: string; profileId?: number };

async function consumeEmailVerificationTransaction(token: string): Promise<EmailVerificationTransactionResult> {
  return db.transaction(async (tx): Promise<EmailVerificationTransactionResult> => {
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
    const [currentUser] = await tx.select({ email: users.email }).from(users).where(eq(users.id, record.userId)).limit(1);
    const [profile] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, record.userId)).limit(1);
    const [billing] = profile ? await tx.select({ externalCustomerId: billingAccounts.externalCustomerId }).from(billingAccounts).where(eq(billingAccounts.profileId, profile.id)).limit(1) : [];
    await tx.update(users).set({
      accountState: profile ? 'active' : 'onboarding',
      email: record.pendingEmail,
      emailDisplay: record.pendingEmailDisplay,
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
    if (currentUser && currentUser.email !== record.pendingEmail) {
      for (const recipient of [record.pendingEmail, currentUser.email]) {
        const dedupeKey = `email-changed:${record.id}:${recipientDiscriminator(recipient)}`;
        await tx.execute(sql`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
          values(${record.userId},'verified_email_changed',${recipient},${dedupeKey})
          on conflict (dedupe_key) where dedupe_key is not null do nothing`);
      }
    }
    return { customerId: billing?.externalCustomerId, email: record.pendingEmail, profileId: profile?.id, status: 'verified', userId: record.userId };
  });
}

const EMAIL_RACE_CONSTRAINTS = new Set(['users_email_unique', 'users_normalized_email_unique']);

function isEmailUniqueRaceViolation(error: unknown): boolean {
  return !!error && typeof error === 'object'
    && (error as { code?: unknown }).code === '23505'
    && EMAIL_RACE_CONSTRAINTS.has((error as { constraint_name?: unknown }).constraint_name as string);
}

export async function consumeEmailVerification(token: string): Promise<VerificationResult> {
  if (token.length < 32 || token.length > 100) return { status: 'invalid' };
  let result: EmailVerificationTransactionResult;
  try {
    result = await consumeEmailVerificationTransaction(token);
  } catch (error) {
    // Two members racing to claim the same new email can both pass the in-transaction existence
    // check before either commits (a plain read takes no lock against a concurrent writer), so a
    // unique constraint is what actually decides the winner -- the loser's UPDATE raises this exact
    // race here, not an application bug. Treat it exactly like the pre-commit existence check above:
    // a normal, expected 'invalid' outcome, not a server error. Two distinct constraints can fire:
    // `users_email_unique` (exact match) and `users_normalized_email_unique` (`lower(email)`, schema.ts)
    // -- the pre-commit check compares against the already-lowercased `pendingEmail`, so it misses an
    // existing user stored with different casing (e.g. `Member@example.com`), and that race resolves
    // via the normalized index instead. drizzle-orm wraps the driver's PostgresError in its own error
    // with the original attached as `.cause` (confirmed by direct reproduction), rather than always
    // exposing `code`/`constraint_name` on the outer object, so both are checked.
    if (isEmailUniqueRaceViolation(error) || isEmailUniqueRaceViolation((error as { cause?: unknown } | null)?.cause)) {
      return { status: 'invalid' };
    }
    throw error;
  }
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
