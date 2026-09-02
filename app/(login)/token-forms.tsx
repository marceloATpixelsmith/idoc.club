'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';

type State = { error?: string; success?: string };
type Action = (state: State, data: FormData) => Promise<State>;

export function AccountLinkForm({ action, heading }: { action: Action; heading: string }) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <AuthShell title={heading}>
      <form action={formAction} className="idoc-auth-form">
        <CsrfField />
        <div className="idoc-auth-field">
          <label className="idoc-auth-label" htmlFor="email">Email Address</label>
          <input autoComplete="email" className="idoc-auth-input" id="email" name="email" required type="email" />
        </div>
        <Feedback state={state} />
        <button className="idoc-auth-button" disabled={pending} type="submit">
          {pending ? <AuthPendingLabel text="Please wait" /> : 'Continue'}
        </button>
        <div className="idoc-auth-actions__center">
          <Link className="idoc-auth-link" href="/sign-in">Back to login</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function TokenPasswordForm({ action, heading, token }: { action: Action; heading: string; token: string }) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <AuthShell title={heading}>
      <form action={formAction} className="idoc-auth-form">
        <CsrfField />
        <input name="token" type="hidden" value={token} />
        <PasswordInput label="New Password" name="password" />
        <PasswordInput label="Confirm Password" name="confirmPassword" />
        <p className="idoc-auth-page__instructions text-left">
          Use at least 12 characters and follow the password requirements enforced by IDOC.
        </p>
        <Feedback state={state} />
        <button className="idoc-auth-button" disabled={pending || !token} type="submit">
          {pending ? <AuthPendingLabel text="Please wait" /> : 'Continue'}
        </button>
      </form>
    </AuthShell>
  );
}

function PasswordInput({ label, name }: { label: string; name: string }) {
  return (
    <div className="idoc-auth-field">
      <label className="idoc-auth-label" htmlFor={name}>{label}</label>
      <input autoComplete="new-password" className="idoc-auth-input" id={name} name={name} required type="password" />
    </div>
  );
}

function Feedback({ state }: { state: State }) {
  return (
    <>
      {state.error ? <p className="idoc-auth-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="m-0 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{state.success}</p> : null}
    </>
  );
}
