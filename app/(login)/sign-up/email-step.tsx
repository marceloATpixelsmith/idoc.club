'use client';

import Link from 'next/link';
import { EmailEntryStep } from '@/components/auth/email-entry-step';
import { startSignup } from './actions';

export function EmailStep() {
  return (
    <EmailEntryStep
      action={startSignup}
      actions={(
        <div className="idoc-auth-actions__center">
          <span className="text-sm text-slate-600">
            Already have an account?{' '}
            <Link className="idoc-auth-link" href="/sign-in">Log in</Link>
          </span>
        </div>
      )}
      dividerLabel="or"
      showGoogle
      submitLabel="Sign up"
      title="Create your account"
      turnstileAction="signup"
    />
  );
}
