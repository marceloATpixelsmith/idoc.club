'use client';

import Link from 'next/link';
import { EmailEntryStep } from '@/components/auth/email-entry-step';
import { startPasswordReset } from './actions';

export function EmailStep() {
  return (
    <EmailEntryStep
      action={startPasswordReset}
      description="Enter your email address and we'll send you a code to reset your password."
      footer={<>Remembered your password?{' '}<Link className="font-medium text-gray-900 underline" href="/sign-in">Sign in</Link></>}
      submitLabel="Send code"
      title="Forgot password?"
      turnstileAction="password-reset"
    />
  );
}
