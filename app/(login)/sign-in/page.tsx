import { getPendingLogin } from '@/lib/auth/pending-login';
import { EmailStep } from './email-step';
import { OtpStep } from './otp-step';
import { PasswordStep } from './password-step';
import { readUiFlash } from '@/lib/ui/flash-state';
import { FlashConsumer } from '@/components/ui/flash-banner';

function signInFlashMessage(code: Awaited<ReturnType<typeof readUiFlash>>) {
  if (code === 'google-link-required') return { error: 'That Google identity is not linked to this existing IDOC account. Sign in with your password first.' };
  if (code === 'google-auth-failed') return { error: 'Google authentication could not be completed. Please try again.' };
  if (code === 'google-unlink-failed') return { error: 'Your new password was saved, but Google could not be disconnected. Sign in with your new password and try disconnecting Google again.' };
  if (code === 'password-created') return { success: 'Your new password is ready. Sign in with it below.' };
  if (code === 'password-changed') return { success: 'Your password was changed. Sign in again on every device.' };
  if (code === 'password-reset-success') return { success: 'Your password was reset. Sign in with your new password.' };
  if (code === 'membership-canceled') return { success: 'Your membership was canceled and you have been signed out.' };
  return {};
}

export default async function SignInPage() {
  const pending = await getPendingLogin();
  if (!pending) {
    const flash = signInFlashMessage(await readUiFlash('/sign-in'));
    return <><FlashConsumer targetPath="/sign-in" /><EmailStep initialError={flash.error} initialSuccess={flash.success} /></>;
  }
  if (pending.stage === 'login-otp') return <OtpStep allowRemember={pending.allowRemember} email={pending.email} pendingCsrfNonce={pending.csrfNonce} />;
  return <PasswordStep email={pending.email} pendingCsrfNonce={pending.csrfNonce} />;
}
