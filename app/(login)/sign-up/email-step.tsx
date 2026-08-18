'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TurnstileWidget } from '@/components/turnstile-widget';
import type { ActionState } from '@/lib/auth/middleware';
import { startSignup } from './actions';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function EmailStep() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(startSignup, { error: '' });
  const [email, setEmail] = useState(state.email ?? '');
  const [turnstileToken, setTurnstileToken] = useState('');
  const canSubmit = EMAIL_PATTERN.test(email) && turnstileToken.length > 0 && !pending;

  return (
    <AuthShell title="Create account">
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
          {pending ? 'Please wait…' : 'Sign Up'}
        </Button>
        <p className="text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link className="font-medium text-gray-900 underline" href="/sign-in">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
