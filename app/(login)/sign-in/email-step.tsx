'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TurnstileWidget } from '@/components/turnstile-widget';
import type { ActionState } from '@/lib/auth/middleware';
import { resendVerification } from '../actions';
import { startLogin } from './actions';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function EmailStep() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(startLogin, { error: '' });
  const [resendState, resendAction, resendPending] = useActionState<ActionState, FormData>(resendVerification, { error: '' });
  const [showResend, setShowResend] = useState(false);
  const [email, setEmail] = useState(state.email ?? '');
  const [turnstileToken, setTurnstileToken] = useState('');
  const canSubmit = EMAIL_PATTERN.test(email) && turnstileToken.length > 0 && !pending;

  return (
    <AuthShell title="Sign in">
      <form action={formAction} className="space-y-4">
        <input name="turnstileToken" type="hidden" value={turnstileToken} />
        <div>
          <Label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="email">Email address</Label>
          <Input
            autoComplete="email" id="email" name="email" onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com" required type="email" value={email}
          />
        </div>
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <TurnstileWidget onVerify={setTurnstileToken} />
        <Button className="w-full" disabled={!canSubmit} size="lg" type="submit">
          {pending ? 'Please wait…' : 'Continue'}
        </Button>
        <p className="text-center text-sm text-gray-600">
          Don&apos;t have an account?{' '}
          <Link className="font-medium text-gray-900 underline" href="/sign-up">Create one</Link>
        </p>
      </form>
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
    </AuthShell>
  );
}
