import { getPendingLogin } from '@/lib/auth/pending-login';
import { EmailStep } from './email-step';
import { OtpStep } from './otp-step';
import { PasswordStep } from './password-step';

export default async function SignInPage() {
  const pending = await getPendingLogin();
  if (!pending) return <EmailStep />;
  if (pending.legacy && !pending.verified) return <OtpStep email={pending.email} />;
  return <PasswordStep email={pending.email} />;
}
