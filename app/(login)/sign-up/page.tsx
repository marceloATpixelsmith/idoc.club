import { getPendingSignup } from '@/lib/auth/pending-signup';
import { EmailStep } from './email-step';
import { OtpStep } from './otp-step';
import { PasswordStep } from './password-step';

export default async function SignUpPage() {
  const pending = await getPendingSignup();
  if (!pending) return <EmailStep />;
  if (!pending.verified) return <OtpStep email={pending.email} />;
  return <PasswordStep />;
}
