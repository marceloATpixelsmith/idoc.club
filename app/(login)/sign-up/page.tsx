import { getPendingSignup } from '@/lib/auth/pending-signup';
import { EmailStep } from './email-step';
import { OtpStep } from './otp-step';
import { PasswordStep } from './password-step';
import { parseMemberClassification } from '@/lib/membership/classification';
import { readUiFlash } from '@/lib/ui/flash-state';
import { FlashConsumer } from '@/components/ui/flash-banner';

function googleErrorMessage(code: Awaited<ReturnType<typeof readUiFlash>>) {
  return code === 'google-auth-failed' ? 'Google authentication could not be completed. Please try again.' : '';
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ membership?: string }>;
}) {
  const pending = await getPendingSignup();
  if (!pending) {
    const params = await searchParams;
    const flash = await readUiFlash('/sign-up');
    return (
      <>
      {flash ? <FlashConsumer targetPath="/sign-up" /> : null}
      <EmailStep
        initialError={googleErrorMessage(flash)}
        membership={parseMemberClassification(params.membership)}
      />
    );
  }
  if (!pending.verified) return <OtpStep email={pending.email} pendingCsrfNonce={pending.csrfNonce} />;
  return <PasswordStep pendingCsrfNonce={pending.csrfNonce} />;
}
