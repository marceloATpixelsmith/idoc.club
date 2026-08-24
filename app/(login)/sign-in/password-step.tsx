'use client';

import { useActionState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordField } from '@/components/auth/password-field';
import type { ActionState } from '@/lib/auth/middleware';
import { signIn } from '../actions';
import { cancelLogin } from './actions';

export function PasswordStep({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(signIn, { error: '' });
  const [, cancelAction] = useActionState<ActionState, FormData>(cancelLogin, { error: '' });

  return (
    <AuthShell>
      <div className="idoc-auth-login-password">
        <div className="idoc-auth-login-password__identity">
          <div>
            Signing in as <span className="idoc-auth-login-password__email">{email}</span>
          </div>
          <form action={cancelAction}>
            <button className="idoc-auth-link border-0 bg-transparent p-0" type="submit">Change</button>
          </form>
        </div>

        <form action={formAction} className="idoc-auth-form">
          <input name="email" type="hidden" value={email} />
          <PasswordField autoComplete="current-password" autoFocus label="Password" />
          {state.error ? <p className="idoc-auth-error" role="alert">{state.error}</p> : null}
          <button className="idoc-auth-button" disabled={pending} type="submit">
            {pending ? 'Signing in…' : 'Sign In'}
          </button>
          <div className="idoc-auth-forgot">
            <a className="idoc-auth-link" href="/recover-password">Forgot password?</a>
          </div>
        </form>
      </div>
    </AuthShell>
  );
}
