'use client';

import { PasswordCreateStep } from '@/components/auth/password-create-step';
import { completePasswordReset } from './actions';

export function PasswordStep() {
  return <PasswordCreateStep action={completePasswordReset} submitLabel="Reset password" title="Create a new password" />;
}
