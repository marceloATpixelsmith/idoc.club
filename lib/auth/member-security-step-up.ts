import 'server-only';

import { issueEmailOtp, verifyEmailOtp, type EmailOtpPurpose } from '@/lib/auth/email-otp';
import { requestOrigin } from '@/lib/security/rate-limit';

/** A member's existing browser session is not adequate proof for sensitive security mutations.
 * The purpose-bound, user-bound, rate-limited code is consumed by the original action, not
 * by an intermediate verification endpoint, so no replayable authorization cookie is issued. */
export async function requireMemberSecurityEmailProof(
  user: { email: string; id: number },
  purpose: Extract<EmailOtpPurpose, 'member_password_change' | 'member_session_revoke'>,
  untrustedCode: string | undefined,
) {
  const origin = await requestOrigin();
  if (untrustedCode !== undefined) {
    const verified = await verifyEmailOtp(user.email, purpose, untrustedCode, origin, user.id);
    if (verified === 'verified') return { approved: true as const };
    const message = verified === 'expired' ? 'The security code expired. Cancel and try the action again.'
      : verified === 'locked' || verified === 'rate_limited' ? 'Too many attempts. Try again later.'
        : 'The security code is incorrect. Check the email we sent you.';
    return { approved: false as const, error: message, stepUpRequired: true as const, stepUpMethod: 'email' as const };
  }
  const sent = await issueEmailOtp(user.email, purpose, { origin, userId: user.id });
  if (sent.status === 'ok' || sent.status === 'cooldown') {
    return { approved: false as const, stepUpRequired: true as const, stepUpMethod: 'email' as const };
  }
  return { approved: false as const, error: sent.status === 'rate_limited'
    ? 'Too many verification requests. Please try again later.'
    : 'The security verification email could not be sent. Please try again.' };
}
