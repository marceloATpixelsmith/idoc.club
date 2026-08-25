import { getPendingPasswordReset } from '@/lib/auth/pending-password-reset';
import { EmailStep } from './email-step';
import { OtpStep } from './otp-step';
import { PasswordStep } from './password-step';
import { TotpStep } from './totp-step';
import { AuthShell } from '@/components/auth/auth-shell';

export default async function RecoverPasswordPage() {
  const pending = await getPendingPasswordReset();
  if (!pending) return <EmailStep />;
  if (pending.stage === 'email-otp') return <OtpStep email={pending.email} />;
  if (pending.stage === 'totp') return <TotpStep />;
  if (pending.stage === 'missing-factor') return (
    <AuthShell description="We cannot complete this recovery request automatically." title="Additional recovery required">
      <p>Contact IDOC support to restore access safely.</p>
    </AuthShell>
  );
  return pending.stage === 'authorized' ? <PasswordStep /> : <EmailStep />;
}
