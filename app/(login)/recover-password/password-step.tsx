'use client';

import Link from 'next/link';
import { PasswordCreateStep } from '@/components/auth/password-create-step';
import { completePasswordReset } from './actions';

export function PasswordStep() {
  return (
    <PasswordCreateStep
      action={completePasswordReset}
      actions={(
        <div className="idoc-auth-actions__center">
          <Link className="idoc-auth-link" href="/sign-in">Back to sign in</Link>
        </div>
      )}
      label="New Password"
      submitLabel="Reset Password"
      title="Reset your password"
    />
  );
}
