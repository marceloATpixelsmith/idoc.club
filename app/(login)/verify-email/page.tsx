import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { setSession } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { consumeEmailVerification } from '@/lib/membership/email-verification';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const result = token ? await consumeEmailVerification(token) : { status: 'invalid' as const };

  if (result.status === 'verified') {
    const [user] = await db.select().from(users).where(eq(users.id, result.userId)).limit(1);
    if (user) await setSession(user);
  }

  const verified = result.status === 'verified';

  return (
    <AuthShell title={verified ? 'Email verified' : 'Verification link unavailable'}>
      <div className="idoc-auth-form">
        <p className="idoc-auth-page__instructions">
          {verified
            ? 'Your address is verified. Complete your IDOC member profile next.'
            : 'This link is invalid, expired, or has already been used.'}
        </p>
        <Link className="idoc-auth-button no-underline" href={verified ? '/onboarding' : '/sign-in'}>
          {verified ? 'Continue to profile' : 'Return to sign in'}
        </Link>
      </div>
    </AuthShell>
  );
}
