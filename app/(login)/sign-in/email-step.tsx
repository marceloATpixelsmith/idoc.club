'use client';

import Link from 'next/link';
import { EmailEntryStep } from '@/components/auth/email-entry-step';
import { startLogin } from './actions';

export function EmailStep({ initialError = '' }: { initialError?: string }) {
  return (
    <EmailEntryStep
      action={startLogin}
      actions={(
        <div className="idoc-auth-actions__row">
          <Link className="idoc-auth-link" href="/sign-up">Create an account</Link>
          <Link className="idoc-auth-link" href="/recover-password">Forgot password?</Link>
        </div>
      )}
      dividerLabel="or continue with"
      googleHref="/api/auth/google/start?intent=login"
      initialError={initialError}
      showGoogle
      submitLabel="Sign In"
      title="Login"
      turnstileAction="login"
    />
  );
}
