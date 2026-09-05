'use client';

import { PasswordCreateStep } from '@/components/auth/password-create-step';
import { completeSignup } from './actions';

export function PasswordStep({ pendingCsrfNonce }: { pendingCsrfNonce: string }) {
  return (
    <PasswordCreateStep
      action={completeSignup}
      label="Create Password"
      pendingCsrfNonce={pendingCsrfNonce}
      submitLabel="Continue"
      title="Create your password"
    />
  );
}
