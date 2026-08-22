'use client';

import { useActionState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordField } from '@/components/auth/password-field';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/auth/middleware';
import { signIn } from '../actions';
import { cancelLogin } from './actions';

export function PasswordStep({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(signIn, { error: '' });
  const [, cancelAction] = useActionState<ActionState, FormData>(cancelLogin, { error: '' });

  return (
    <AuthShell description={<>Signing in as <span className="font-semibold text-gray-900">{email}</span>.</>} title="Enter your password">
      <form action={formAction} className="space-y-4">
        <input name="email" type="hidden" value={email} />
        <PasswordField autoComplete="current-password" autoFocus label="Password" />
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <Button className="w-full" disabled={pending} size="lg" type="submit">
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <div className="mt-4 space-y-1 text-center text-sm">
        <p><a className="font-medium text-gray-900 underline" href="/recover-password">Forgot your password?</a></p>
        <form action={cancelAction}>
          <button className="cursor-pointer text-gray-600 underline" type="submit">Use a different email address</button>
        </form>
      </div>
    </AuthShell>
  );
}
