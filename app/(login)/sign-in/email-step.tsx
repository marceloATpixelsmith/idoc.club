'use client';

import Link from 'next/link';
import { EmailEntryStep } from '@/components/auth/email-entry-step';
import { startLogin } from './actions';

export function EmailStep() {
  return (
    <EmailEntryStep
      action={startLogin}
      footer={<>Don&apos;t have an account?{' '}<Link className="font-medium text-gray-900 underline" href="/sign-up">Create one</Link></>}
      submitLabel="Continue"
      title="Sign in"
      turnstileAction="login"
    />
  );
}
