import { getPendingSignup } from '@/lib/auth/pending-signup';
import { EmailStep } from './email-step';
import { OtpStep } from './otp-step';
import { PasswordStep } from './password-step';

function googleErrorMessage(value?: string) {
  if (value === 'failed') {
    return 'Google authentication could not be completed. Please try again.';
  }
  return '';
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const pending = await getPendingSignup();
  if (!pending) {
    const params = await searchParams;
    return <EmailStep initialError={googleErrorMessage(params.google)} />;
  }
  if (!pending.verified) return <OtpStep email={pending.email} />;
  return <PasswordStep />;
}
