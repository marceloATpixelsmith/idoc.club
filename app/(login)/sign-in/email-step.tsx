'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { EmailEntryStep } from '@/components/auth/email-entry-step';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionState } from '@/lib/auth/middleware';
import { resendVerification } from '../actions';
import { startLogin } from './actions';

export function EmailStep() {
  const [resendState, resendAction, resendPending] = useActionState<ActionState, FormData>(resendVerification, { error: '' });
  const [showResend, setShowResend] = useState(false);

  return (
    <EmailEntryStep
      action={startLogin}
      below={
        <div className="mt-4 text-center text-xs text-gray-500">
          {showResend ? (
            <form action={resendAction} className="space-y-2">
              <Label className="block text-left" htmlFor="resend-email">Email address to resend a verification link to</Label>
              <div className="flex gap-2">
                <Input id="resend-email" name="email" placeholder="Email address" required type="email" />
                <Button disabled={resendPending} size="sm" type="submit">Resend</Button>
              </div>
              {resendState.success ? <p className="text-left text-gray-600">{resendState.success}</p> : null}
            </form>
          ) : (
            <button className="cursor-pointer underline" onClick={() => setShowResend(true)} type="button">
              Changed your email and need a new verification link?
            </button>
          )}
        </div>
      }
      footer={<>Don&apos;t have an account?{' '}<Link className="font-medium text-gray-900 underline" href="/sign-up">Create one</Link></>}
      submitLabel="Continue"
      title="Sign in"
    />
  );
}
