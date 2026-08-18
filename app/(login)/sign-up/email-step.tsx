'use client';

import Link from 'next/link';
import { EmailEntryStep } from '@/components/auth/email-entry-step';
import { startSignup } from './actions';

export function EmailStep() {
  return (
    <EmailEntryStep
      action={startSignup}
      footer={<>Already have an account?{' '}<Link className="font-medium text-gray-900 underline" href="/sign-in">Sign in</Link></>}
      submitLabel="Sign Up"
      title="Create account"
    />
  );
}
