'use client';

import Link from 'next/link';
import { EmailEntryStep } from '@/components/auth/email-entry-step';
import { startSignup } from './actions';

export function EmailStep({ initialError = '', membership }: { initialError?: string; membership: string | null }) {
  const membershipQuery = membership ? `&returnTo=${encodeURIComponent(`/dashboard?membership=${membership}`)}` : '';
  return (
    <EmailEntryStep
      action={startSignup}
      actions={(
        <div className="idoc-auth-actions__center">
          <span className="text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link className="idoc-auth-link" href="/sign-in">Log in</Link>
          </span>
        </div>
      )}
      dividerLabel="or"
      googleHref={`/api/auth/google/start?intent=signup${membershipQuery}`}
      hiddenFields={membership ? { membership } : undefined}
      initialError={initialError}
      showGoogle
      submitLabel="Sign up"
      title="Create your account"
      turnstileAction="signup"
    />
  );
}
