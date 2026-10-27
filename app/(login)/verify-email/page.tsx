import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { consumeEmailVerification } from '@/lib/membership/email-verification';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const result = token ? await consumeEmailVerification(token) : { status: 'invalid' as const };
  const verified = result.status === 'verified';

  // Redeeming the link changes the login address and ends every session (consumeEmailVerification bumps the session version), so the
  // member signs in again with the new address. A link in an email never starts a session itself: that was also rejected by the
  // framework during render, which answered HTTP 500 after the change had already been committed.
  return (
    <AuthShell title={verified ? 'Email verified' : 'Verification link unavailable'}>
      <div className="idoc-auth-form">
        <p className="idoc-auth-page__instructions">
          {verified
            ? 'Your address is verified. Sign in with it to continue.'
            : 'This link is invalid, expired, or has already been used.'}
        </p>
        <Link className="idoc-auth-button no-underline" href="/sign-in">Return to sign in</Link>
      </div>
    </AuthShell>
  );
}
