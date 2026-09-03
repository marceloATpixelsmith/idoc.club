import 'server-only';

import { createHash, randomInt } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { emailOtpCodes } from '@/lib/db/schema';
import { sendTransactionalEmail } from '@/lib/notifications/mailchimp-transactional';
import { emailCode, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { normalizeEmail } from '@/lib/membership/validation';
import { logError } from '@/lib/observability/logger';

export type EmailOtpPurpose = 'login_verification' | 'password_reset' | 'signup_verification';

const CODE_LIFETIME_MS = 15 * 60 * 1000;
const CODE_LENGTH = 6;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;
const RATE_LIMIT_PURPOSES: Record<EmailOtpPurpose, { issue: string; verify: string }> = {
  login_verification: { issue: 'email_otp_login_verification', verify: 'otp_verify_login' },
  password_reset: { issue: 'email_otp_password_reset', verify: 'otp_verify_reset' },
  signup_verification: { issue: 'email_otp_signup_verification', verify: 'otp_verify_signup' },
};

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const generateCode = () => randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, '0');

/** Matches lib/membership/account-recovery.ts's operationalFailureCategory: derives a category from
 * the exception without ever retaining the exception text itself in logged evidence. */
function deliveryFailureCategory(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('not configured') || message.includes('configuration')) return 'configuration';
  if (message.includes('connect') || message.includes('network')) return 'network';
  return 'operational';
}

const SUBJECTS: Record<EmailOtpPurpose, string> = {
  login_verification: 'Your IDOC sign-in code',
  password_reset: 'Your IDOC password reset code',
  signup_verification: 'Your IDOC verification code',
};

function emailHtml(code: string, purpose: EmailOtpPurpose) {
  const intro = purpose === 'password_reset'
    ? 'Use this code to reset your IDOC password.'
    : purpose === 'login_verification'
      ? 'Use this code to sign in to your IDOC account.'
      : 'Use this code to verify your email address for IDOC.';
  return renderTransactionalEmail({
    bodyHtml: `<p style="text-align:center;">${intro}</p>${emailCode(code)}`,
    footerNote: 'This code expires in 15 minutes. If you did not request this, you can safely ignore this email.',
  });
}

export type IssueEmailOtpResult = { status: 'ok' } | { status: 'cooldown'; retryAfterMs: number } | { status: 'delivery_failed' } | { status: 'rate_limited' };

/** Issues (or re-issues) a 6-digit code for the given email/purpose, sending it synchronously.
 * Not queued through the async account-delivery outbox: this short-lived code is only useful
 * delivered immediately, not sitting in a retry queue. A delivery failure is caught here and
 * reported as a distinct status rather than allowed to become an unhandled exception. */
export async function issueEmailOtp(untrustedEmail: string, purpose: EmailOtpPurpose, options: { origin?: string; userId?: number } = {}): Promise<IssueEmailOtpResult> {
  const email = normalizeEmail(untrustedEmail);
  const now = new Date();
  const [latest] = await db.select({ createdAt: emailOtpCodes.createdAt }).from(emailOtpCodes)
    .where(and(eq(emailOtpCodes.email, email), eq(emailOtpCodes.purpose, purpose)))
    .orderBy(desc(emailOtpCodes.createdAt)).limit(1);
  if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return { retryAfterMs: RESEND_COOLDOWN_MS - (now.getTime() - latest.createdAt.getTime()), status: 'cooldown' };
  }
  const allowed = await checkRateLimit(RATE_LIMIT_PURPOSES[purpose].issue, email, options.origin ?? 'unknown', now);
  if (!allowed) return { status: 'rate_limited' };
  const code = generateCode();
  await db.update(emailOtpCodes).set({ consumedAt: now })
    .where(and(eq(emailOtpCodes.email, email), eq(emailOtpCodes.purpose, purpose), isNull(emailOtpCodes.consumedAt)));
  await db.insert(emailOtpCodes).values({
    codeHash: digest(code), email, expiresAt: new Date(now.getTime() + CODE_LIFETIME_MS),
    purpose, userId: options.userId ?? null,
  });
  try {
    await sendTransactionalEmail({ html: emailHtml(code, purpose), subject: SUBJECTS[purpose], to: email });
  } catch (error) {
    const reason = deliveryFailureCategory(error);
    if (options.userId) await logError('email_otp_delivery_failed', { purpose, reason, subjectId: options.userId });
    else await logError('email_otp_anonymous_delivery_failed', { purpose, reason });
    return { status: 'delivery_failed' };
  }
  return { status: 'ok' };
}

export type VerifyEmailOtpResult = 'expired' | 'invalid' | 'locked' | 'rate_limited' | 'verified';

/** Verifies a submitted code against the latest unconsumed, unexpired code for this email/purpose.
 * Each call against an existing record increments its attempt counter first. Verification attempts
 * are additionally rate-limited independently by email and origin. */
export async function verifyEmailOtp(untrustedEmail: string, purpose: EmailOtpPurpose, code: string, origin = 'unknown', expectedUserId?: number): Promise<VerifyEmailOtpResult> {
  if (!/^\d{6}$/.test(code)) return 'invalid';
  const email = normalizeEmail(untrustedEmail);
  const allowed = await checkRateLimit(RATE_LIMIT_PURPOSES[purpose].verify, email, origin);
  if (!allowed) return 'rate_limited';
  return db.transaction(async (tx) => {
    const conditions = [eq(emailOtpCodes.email, email), eq(emailOtpCodes.purpose, purpose), isNull(emailOtpCodes.consumedAt)];
    if (expectedUserId !== undefined) conditions.push(eq(emailOtpCodes.userId, expectedUserId));
    const [record] = await tx.select().from(emailOtpCodes)
      .where(and(...conditions))
      .orderBy(desc(emailOtpCodes.createdAt)).limit(1);
    if (!record) return 'invalid';
    if (record.expiresAt.getTime() < Date.now()) return 'expired';
    if (record.attemptCount >= MAX_VERIFY_ATTEMPTS) return 'locked';
    const [updated] = await tx.update(emailOtpCodes).set({ attemptCount: sql`${emailOtpCodes.attemptCount} + 1` })
      .where(eq(emailOtpCodes.id, record.id)).returning({ attemptCount: emailOtpCodes.attemptCount });
    if (updated.attemptCount > MAX_VERIFY_ATTEMPTS) return 'locked';
    if (digest(code) !== record.codeHash) return 'invalid';
    const [consumed] = await tx.update(emailOtpCodes).set({ consumedAt: new Date() }).where(and(
      eq(emailOtpCodes.id, record.id),
      isNull(emailOtpCodes.consumedAt),
    )).returning({ id: emailOtpCodes.id });
    return consumed ? 'verified' : 'invalid';
  });
}

export async function pendingEmailOtpCooldownMs(untrustedEmail: string, purpose: EmailOtpPurpose): Promise<number> {
  const email = normalizeEmail(untrustedEmail);
  const [latest] = await db.select({ createdAt: emailOtpCodes.createdAt }).from(emailOtpCodes)
    .where(and(eq(emailOtpCodes.email, email), eq(emailOtpCodes.purpose, purpose)))
    .orderBy(desc(emailOtpCodes.createdAt)).limit(1);
  if (!latest) return 0;
  const elapsed = Date.now() - latest.createdAt.getTime();
  return Math.max(0, RESEND_COOLDOWN_MS - elapsed);
}
