'use client';

import { PasswordCreateStep } from '@/components/auth/password-create-step';
import { activateLegacyAccount } from './actions';

export function ActivatePasswordStep() {
  return (
    <PasswordCreateStep
      action={activateLegacyAccount}
      description="Your email is verified. Set a password to continue."
      submitLabel="Continue"
      title="Set your password"
    />
  );
}
