import { getPendingSignup } from '@/lib/auth/pending-signup';
import { EmailStep } from './email-step';
import { OtpStep } from './otp-step';
import { PasswordStep } from './password-step';
import { parseMemberClassification } from '@/lib/membership/classification';

function googleErrorMessage(value?: string) {
  if (value === 'failed') {
    return 'Google authentication could not be completed. Please try again.';
  }
  return '';
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; membership?: string }>;
}) {
  const pending = await getPendingSignup();
  if (!pending) {
    const params = await searchParams;
    return (
      <EmailStep
        initialError={googleErrorMessage(params.google)}
        membership={parseMemberClassification(params.membership)}
      />
    );
  }
  if (!pending.verified) return <OtpStep email={pending.email} pendingCsrfNonce={pending.csrfNonce} />;
  return <PasswordStep pendingCsrfNonce={pending.csrfNonce} />;
}
