import { TokenPasswordForm } from '../token-forms';
import { resetPassword } from '../actions';
import { recordTokenLinkOpened } from '@/lib/activity/token-link-activity';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (token) await recordTokenLinkOpened(token, 'password_reset');
  return <TokenPasswordForm action={resetPassword} heading="Choose a new password" token={token ?? ''} />;
}
