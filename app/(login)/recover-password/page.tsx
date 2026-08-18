import { getPendingPasswordReset } from '@/lib/auth/pending-password-reset';
import { EmailStep } from './email-step';
import { OtpStep } from './otp-step';
import { PasswordStep } from './password-step';

export default async function RecoverPasswordPage() {
  const pending = await getPendingPasswordReset();
  if (!pending) return <EmailStep />;
  if (!pending.verified) return <OtpStep email={pending.email} />;
  return <PasswordStep />;
}
