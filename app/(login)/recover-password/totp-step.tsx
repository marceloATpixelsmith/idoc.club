'use client';

import { useActionState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import type { ActionState } from '@/lib/auth/middleware';
import { cancelPasswordReset, verifyPasswordResetTotp } from './actions';

export function TotpStep() {
  const [state, action, pending] = useActionState<ActionState, FormData>(verifyPasswordResetTotp, {});
  const [, cancel] = useActionState<ActionState, FormData>(cancelPasswordReset, {});
  return (
    <AuthShell description="Enter the current 6-digit code from your authenticator app." title="Verify your identity">
      <form action={action} className="idoc-auth-form">
        <label>Authenticator code<input autoComplete="one-time-code" autoFocus inputMode="numeric" maxLength={6} name="code" pattern="[0-9]{6}" required /></label>
        {state.error ? <p className="idoc-auth-error" role="alert">{state.error}</p> : null}
        <button className="idoc-auth-button" disabled={pending} type="submit">{pending ? 'Verifying…' : 'Verify'}</button>
      </form>
      <form action={cancel} className="idoc-auth-actions__center">
        <button className="idoc-auth-link border-0 bg-transparent p-0" type="submit">Start again</button>
      </form>
    </AuthShell>
  );
}
