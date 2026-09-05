import { getPendingPasswordReset } from '@/lib/auth/pending-password-reset';
import { EmailStep } from './email-step';
import { OtpStep } from './otp-step';
import { PasswordStep } from './password-step';

export default async function RecoverPasswordPage() {
  const pending = await getPendingPasswordReset();
  if (!pending) return <EmailStep />;
  if (pending.stage === 'authorized') return <PasswordStep pendingCsrfNonce={pending.csrfNonce} />;
  return <OtpStep pendingCsrfNonce={pending.csrfNonce} />;
}
