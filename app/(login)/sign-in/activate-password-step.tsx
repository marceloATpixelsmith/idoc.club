'use client';

import { PasswordCreateStep } from '@/components/auth/password-create-step';
import { activateLegacyAccount } from './actions';

export function ActivatePasswordStep() {
  return (
    <PasswordCreateStep
      action={activateLegacyAccount}
      description="Your email is verified. Set a new password to finish activating your account."
      submitLabel="Activate account"
      title="Set your password"
    />
  );
}
