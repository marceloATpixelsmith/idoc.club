import 'server-only';

import { createHash, randomInt } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { emailOtpCodes } from '@/lib/db/schema';
import { sendTransactionalEmail } from '@/lib/notifications/brevo-transactional';
import { emailCode, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { normalizeEmail } from '@/lib/membership/validation';
import { logError } from '@/lib/observability/logger';

export type EmailOtpPurpose = 'google_disconnect_verification' | 'login_verification' | 'password_reset' | 'signup_verification' | 'member_password_change' | 'member_session_revoke';

const CODE_LIFETIME_MS = 15 * 60 * 1000;
const CODE_LENGTH = 6;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;
const RATE_LIMIT_PURPOSES: Record<EmailOtpPurpose, { issue: string; verify: string }> = {
  google_disconnect_verification: { issue: 'email_otp_google_disconnect', verify: 'otp_verify_google_disconnect' },
  login_verification: { issue: 'email_otp_login_verification', verify: 'otp_verify_login' },
  member_password_change: { issue: 'email_otp_member_password', verify: 'otp_verify_member_password' },
  member_session_revoke: { issue: 'email_otp_member_revoke', verify: 'otp_verify_member_revoke' },
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

export const EMAIL_OTP_SUBJECTS: Record<EmailOtpPurpose, string> = {
  google_disconnect_verification: 'Your IDOC verification code',
  login_verification: 'Your IDOC sign-in code',
  member_password_change: 'Confirm your IDOC password change',
  member_session_revoke: 'Confirm your IDOC session sign-out',
  password_reset: 'Your IDOC password reset code',
  signup_verification: 'Your IDOC verification code',
};

export function renderEmailOtpHtml(code: string, purpose: EmailOtpPurpose) {
  const intro = purpose === 'password_reset'
    ? 'Use this code to reset your IDOC password.'
    : purpose === 'login_verification'
      ? 'Use this code to sign in to your IDOC account.'
      : purpose === 'member_password_change'
        ? 'Use this code to approve a password change. If you did not request it, someone may be accessing your account.'
        : purpose === 'member_session_revoke'
          ? 'Use this code to approve signing out other devices. If you did not request it, someone may be accessing your account.'
      : purpose === 'google_disconnect_verification'
        ? 'Use this code to confirm it’s really you before creating a password and disconnecting Google from your IDOC account.'
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
  const [latest] = await db.select({ createdAt: emailOtpCodes.createdAt, consumedAt: emailOtpCodes.consumedAt }).from(emailOtpCodes)
    .where(and(eq(emailOtpCodes.email, email), eq(emailOtpCodes.purpose, purpose)))
    .orderBy(desc(emailOtpCodes.createdAt)).limit(1);
  // A consumed one-time code cannot authorize another operation. Allow a new security
  // challenge immediately; the shared per-email/per-origin send limits still apply.
  if (latest && !latest.consumedAt && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return { retryAfterMs: RESEND_COOLDOWN_MS - (now.getTime() - latest.createdAt.getTime()), status: 'cooldown' };
  }
  const allowed = await checkRateLimit(RATE_LIMIT_PURPOSES[purpose].issue, email, options.origin ?? 'unknown', now);
  if (!allowed) return { status: 'rate_limited' };
  const code = generateCode();
  // Mail can arrive late, and a member who asks again must not lose the code already on its way.
  // Keep the newest still-valid previous code alive beside the new one (at most two live codes);
  // every older outstanding code is superseded.
  const [previous] = await db.select({ id: emailOtpCodes.id }).from(emailOtpCodes)
    .where(and(eq(emailOtpCodes.email, email), eq(emailOtpCodes.purpose, purpose), isNull(emailOtpCodes.consumedAt), gt(emailOtpCodes.expiresAt, now)))
    .orderBy(desc(emailOtpCodes.createdAt)).limit(1);
  await db.update(emailOtpCodes).set({ consumedAt: now })
    .where(and(eq(emailOtpCodes.email, email), eq(emailOtpCodes.purpose, purpose), isNull(emailOtpCodes.consumedAt), previous ? ne(emailOtpCodes.id, previous.id) : undefined));
  await db.insert(emailOtpCodes).values({
    codeHash: digest(code), email, expiresAt: new Date(now.getTime() + CODE_LIFETIME_MS),
    purpose, userId: options.userId ?? null,
  });
  try {
    await sendTransactionalEmail({ html: renderEmailOtpHtml(code, purpose), subject: EMAIL_OTP_SUBJECTS[purpose], to: email }, { allowLiveAuthE2eOtp: true, authenticationEmail: true, kind: `auth.otp.${purpose}`, userId: options.userId });
  } catch (error) {
    const reason = deliveryFailureCategory(error);
    if (options.userId) await logError('email_otp_delivery_failed', { purpose, reason, subjectId: options.userId });
    else await logError('email_otp_anonymous_delivery_failed', { purpose, reason });
    return { status: 'delivery_failed' };
  }
  return { status: 'ok' };
}

export type VerifyEmailOtpResult = 'expired' | 'invalid' | 'locked' | 'rate_limited' | 'verified';

/** Verifies a submitted code against the (at most two) newest unconsumed codes for this email/purpose.
 * Each call increments the attempt counter of every code it is checked against before comparing, so
 * a guess spends the budget of both live codes. Verification attempts are additionally rate-limited
 * independently by email and origin. A successful verification consumes all of them. */
export async function verifyEmailOtp(untrustedEmail: string, purpose: EmailOtpPurpose, code: string, origin = 'unknown', expectedUserId?: number): Promise<VerifyEmailOtpResult> {
  if (!/^\d{6}$/.test(code)) return 'invalid';
  const email = normalizeEmail(untrustedEmail);
  const allowed = await checkRateLimit(RATE_LIMIT_PURPOSES[purpose].verify, email, origin);
  if (!allowed) return 'rate_limited';
  return db.transaction(async (tx) => {
    const conditions = [eq(emailOtpCodes.email, email), eq(emailOtpCodes.purpose, purpose), isNull(emailOtpCodes.consumedAt)];
    if (expectedUserId !== undefined) conditions.push(eq(emailOtpCodes.userId, expectedUserId));
    const records = await tx.select().from(emailOtpCodes)
      .where(and(...conditions))
      .orderBy(desc(emailOtpCodes.createdAt)).limit(2);
    if (records.length === 0) return 'invalid';
    const unexpired = records.filter((record) => record.expiresAt.getTime() >= Date.now());
    if (unexpired.length === 0) return 'expired';
    const open = unexpired.filter((record) => record.attemptCount < MAX_VERIFY_ATTEMPTS);
    if (open.length === 0) return 'locked';
    const updated = await tx.update(emailOtpCodes).set({ attemptCount: sql`${emailOtpCodes.attemptCount} + 1` })
      .where(inArray(emailOtpCodes.id, open.map((record) => record.id))).returning({ attemptCount: emailOtpCodes.attemptCount, id: emailOtpCodes.id });
    const counted = new Set(updated.filter((row) => row.attemptCount <= MAX_VERIFY_ATTEMPTS).map((row) => row.id));
    if (counted.size === 0) return 'locked';
    const match = open.find((record) => counted.has(record.id) && digest(code) === record.codeHash);
    if (!match) return 'invalid';
    const consumed = await tx.update(emailOtpCodes).set({ consumedAt: new Date() }).where(and(
      inArray(emailOtpCodes.id, records.map((record) => record.id)),
      isNull(emailOtpCodes.consumedAt),
    )).returning({ id: emailOtpCodes.id });
    return consumed.some((row) => row.id === match.id) ? 'verified' : 'invalid';
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
