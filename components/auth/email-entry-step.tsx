'use client';

import type { ReactNode } from 'react';
import { useActionState, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { TurnstileWidget } from '@/components/turnstile-widget';
import type { ActionState } from '@/lib/auth/middleware';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type EmailAction = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

export function EmailEntryStep({
  action,
  actions,
  description,
  dividerLabel,
  googleHref,
  initialError = '',
  showGoogle = false,
  submitLabel,
  title,
  turnstileAction,
}: {
  action: EmailAction;
  actions?: ReactNode;
  description?: ReactNode;
  dividerLabel?: string;
  googleHref?: string;
  initialError?: string;
  showGoogle?: boolean;
  submitLabel: string;
  title: string;
  turnstileAction: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, { error: initialError });
  const [email, setEmail] = useState(state.email ?? '');
  const [turnstileToken, setTurnstileToken] = useState('');
  const canSubmit = EMAIL_PATTERN.test(email) && turnstileToken.length > 0 && !pending;

  return (
    <AuthShell description={description} title={title}>
      <form action={formAction} className="idoc-auth-form">
        <input name="turnstileToken" type="hidden" value={turnstileToken} />

        <div className="idoc-auth-field">
          <label className="idoc-auth-label" htmlFor="email">Email Address</label>
          <input
            autoComplete="email"
            className="idoc-auth-input"
            id="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
        </div>

        {state.error ? <p className="idoc-auth-error" role="alert">{state.error}</p> : null}

        <TurnstileWidget action={turnstileAction} onVerify={setTurnstileToken} />

        <button className="idoc-auth-button" disabled={!canSubmit} type="submit">
          {pending ? <AuthPendingLabel text="Please wait" /> : submitLabel}
        </button>

        {showGoogle ? (
          <>
            <div className="idoc-auth-divider">
              <span className="idoc-auth-divider__line" />
              <span className="idoc-auth-divider__label">{dividerLabel ?? 'or continue with'}</span>
              <span className="idoc-auth-divider__line" />
            </div>

            {googleHref ? (
              <a className="idoc-auth-google-button" href={googleHref}>
                <GoogleIcon />
                <span>Continue with Google</span>
              </a>
            ) : (
              <button
                aria-disabled="true"
                className="idoc-auth-google-button"
                disabled
                title="Google sign-in is not configured yet."
                type="button"
              >
                <GoogleIcon />
                <span>Continue with Google</span>
              </button>
            )}
          </>
        ) : null}

        {actions ? <div className="idoc-auth-actions">{actions}</div> : null}
      </form>
    </AuthShell>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="idoc-auth-google-icon" focusable="false" viewBox="0 0 24 24">
      <path d="M21.35 12.21c0-.74-.07-1.45-.19-2.13H12v4.03h5.24a4.48 4.48 0 0 1-1.95 2.94v2.62h3.16c1.85-1.7 2.9-4.21 2.9-7.46Z" fill="#4285F4" />
      <path d="M12 21.72c2.64 0 4.86-.87 6.48-2.37l-3.16-2.62c-.88.59-2 .94-3.32.94-2.55 0-4.71-1.72-5.48-4.04H3.25v2.7A9.78 9.78 0 0 0 12 21.72Z" fill="#34A853" />
      <path d="M6.52 13.63a5.87 5.87 0 0 1 0-3.75V7.18H3.25a9.79 9.79 0 0 0 0 9.15l3.27-2.7Z" fill="#FBBC05" />
      <path d="M12 5.84c1.44 0 2.73.5 3.75 1.46l2.81-2.81A9.4 9.4 0 0 0 12 1.78a9.78 9.78 0 0 0-8.75 5.4l3.27 2.7C7.29 7.56 9.45 5.84 12 5.84Z" fill="#EA4335" />
    </svg>
  );
}
