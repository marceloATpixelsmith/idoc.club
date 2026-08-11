import Link from 'next/link';
import { consumeEmailVerification } from '@/lib/membership/email-verification';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { setSession } from '@/lib/auth/session';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const result = token ? await consumeEmailVerification(token) : { status: 'invalid' as const };
  if (result.status === 'verified') {
    const [user] = await db.select().from(users).where(eq(users.id, result.userId)).limit(1);
    if (user) await setSession(user);
  }
  return <main className="mx-auto max-w-lg p-8 text-center">
    <h1 className="text-2xl font-semibold">{result.status === 'verified' ? 'Email verified' : 'Verification link unavailable'}</h1>
    <p className="my-4">{result.status === 'verified' ? 'Your address is verified. Complete your IDOC member profile next.' : 'This link is invalid, expired, or has already been used.'}</p>
    <Link className="underline" href={result.status === 'verified' ? '/onboarding' : '/sign-in'}>{result.status === 'verified' ? 'Continue to profile' : 'Return to sign in'}</Link>
  </main>;
}
