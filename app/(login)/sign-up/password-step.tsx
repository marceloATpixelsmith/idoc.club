'use client';

import { PasswordCreateStep } from '@/components/auth/password-create-step';
import { completeSignup } from './actions';

export function PasswordStep() {
  return <PasswordCreateStep action={completeSignup} label="Create Password" submitLabel="Finish" title="Create account" />;
}
