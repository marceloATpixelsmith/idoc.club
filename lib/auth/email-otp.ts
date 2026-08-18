import 'server-only';

import { createHash, randomInt } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { emailOtpCodes } from '@/lib/db/schema';
import { sendTransactionalEmail } from '@/lib/notifications/mailchimp-transactional';
import { emailCode, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { rateLimitHashKeyForServer } from '@/lib/runtime/configuration';
import { normalizeEmail } from '@/lib/membership/validation';

export type EmailOtpPurpose = 'login_verification' | 'password_reset' | 'signup_verification';

const CODE_LIFETIME_MS = 30 * 60 * 1000;
const CODE_LENGTH = 6;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_REQUESTS = 3;

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const generateCode = () => randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, '0');

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
    footerNote: 'This code expires in 30 minutes. If you did not request this, you can safely ignore this email.',
  });
}

async function takeAllowance(email: string, purpose: EmailOtpPurpose, origin: string, now: Date) {
  const secret = rateLimitHashKeyForServer();
  const windowStartedAt = new Date(Math.floor(now.getTime() / RATE_WINDOW_MS) * RATE_WINDOW_MS);
  const identifierHash = digest(`${secret}:otp:${email}`);
  const originHash = digest(`${secret}:origin:${origin || 'unknown'}`);
  const rows = await db.execute<{ request_count: number }>(sql`
    insert into idoc.account_request_limits (purpose, identifier_hash, origin_hash, window_started_at)
    values (${`email_otp_${purpose}`}, ${identifierHash}, ${originHash}, ${windowStartedAt.toISOString()})
    on conflict (purpose, identifier_hash, origin_hash, window_started_at)
    do update set request_count = idoc.account_request_limits.request_count + 1, updated_at = now()
    returning request_count
  `);
  return Boolean(rows[0] && rows[0].request_count <= RATE_MAX_REQUESTS);
}

export type IssueEmailOtpResult = { status: 'ok' } | { status: 'cooldown'; retryAfterMs: number } | { status: 'delivery_failed' } | { status: 'rate_limited' };

/** Issues (or re-issues) a 6-digit code for the given email/purpose, sending it synchronously.
 * Not queued through the async account-delivery outbox: a 30-minute-lifetime code is only useful
 * delivered immediately, not sitting in a retry queue. A delivery failure (provider outage, bad
 * credentials, network error) is caught here and reported as a distinct status rather than left to
 * propagate as an unhandled exception — every caller must be able to show the member an actionable
 * "we couldn't send that" message instead of crashing to a generic error page. */
export async function issueEmailOtp(untrustedEmail: string, purpose: EmailOtpPurpose, options: { origin?: string; userId?: number } = {}): Promise<IssueEmailOtpResult> {
  const email = normalizeEmail(untrustedEmail);
  const now = new Date();
  const [latest] = await db.select({ createdAt: emailOtpCodes.createdAt }).from(emailOtpCodes)
    .where(and(eq(emailOtpCodes.email, email), eq(emailOtpCodes.purpose, purpose)))
    .orderBy(desc(emailOtpCodes.createdAt)).limit(1);
  if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return { retryAfterMs: RESEND_COOLDOWN_MS - (now.getTime() - latest.createdAt.getTime()), status: 'cooldown' };
  }
  const allowed = await takeAllowance(email, purpose, options.origin ?? 'unknown', now);
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
    console.error('email_otp_delivery_failed', { category: 'operational', message: error instanceof Error ? error.message : 'unknown', purpose });
    return { status: 'delivery_failed' };
  }
  return { status: 'ok' };
}

export type VerifyEmailOtpResult = 'expired' | 'invalid' | 'locked' | 'verified';

/** Verifies a submitted code against the latest unconsumed, unexpired code for this email/purpose.
 * Each call against an existing record increments its attempt counter first, so even a crashed or
 * short-circuited request still counts toward the lockout. */
export async function verifyEmailOtp(untrustedEmail: string, purpose: EmailOtpPurpose, code: string): Promise<VerifyEmailOtpResult> {
  if (!/^\d{6}$/.test(code)) return 'invalid';
  const email = normalizeEmail(untrustedEmail);
  return db.transaction(async (tx) => {
    const [record] = await tx.select().from(emailOtpCodes)
      .where(and(eq(emailOtpCodes.email, email), eq(emailOtpCodes.purpose, purpose), isNull(emailOtpCodes.consumedAt)))
      .orderBy(desc(emailOtpCodes.createdAt)).limit(1);
    if (!record) return 'invalid';
    if (record.expiresAt.getTime() < Date.now()) return 'expired';
    if (record.attemptCount >= MAX_VERIFY_ATTEMPTS) return 'locked';
    const [updated] = await tx.update(emailOtpCodes).set({ attemptCount: sql`${emailOtpCodes.attemptCount} + 1` })
      .where(eq(emailOtpCodes.id, record.id)).returning({ attemptCount: emailOtpCodes.attemptCount });
    if (updated.attemptCount > MAX_VERIFY_ATTEMPTS) return 'locked';
    if (digest(code) !== record.codeHash) return 'invalid';
    await tx.update(emailOtpCodes).set({ consumedAt: new Date() }).where(eq(emailOtpCodes.id, record.id));
    return 'verified';
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
