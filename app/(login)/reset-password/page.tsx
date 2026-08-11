import { TokenPasswordForm } from '../token-forms';
import { resetPassword } from '../actions';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <TokenPasswordForm action={resetPassword} heading="Choose a new password" token={token ?? ''} />;
}
