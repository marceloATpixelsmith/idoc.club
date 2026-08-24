'use client';

import Link from 'next/link';
import { EmailEntryStep } from '@/components/auth/email-entry-step';
import { startPasswordReset } from './actions';

export function EmailStep() {
  return (
    <EmailEntryStep
      action={startPasswordReset}
      actions={(
        <div className="idoc-auth-actions__center">
          <Link className="idoc-auth-link" href="/sign-in">Back to login</Link>
        </div>
      )}
      submitLabel="Continue"
      title="Reset your password"
      turnstileAction="password-reset"
    />
  );
}
