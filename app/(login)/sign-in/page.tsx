import { getPendingLogin } from '@/lib/auth/pending-login';
import { EmailStep } from './email-step';
import { OtpStep } from './otp-step';
import { PasswordStep } from './password-step';

function googleErrorMessage(value?: string) {
  if (value === 'link-required') {
    return 'That Google identity is not linked to this existing IDOC account. Sign in with your password first.';
  }
  if (value === 'failed') {
    return 'Google authentication could not be completed. Please try again.';
  }
  return '';
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const pending = await getPendingLogin();
  if (!pending) {
    const params = await searchParams;
    return <EmailStep initialError={googleErrorMessage(params.google)} />;
  }
  if (pending.legacy && !pending.verified) return <OtpStep email={pending.email} />;
  return <PasswordStep email={pending.email} />;
}
