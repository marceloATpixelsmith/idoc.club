'use client';

import type { ReactNode } from 'react';
import { useActionState, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordField } from '@/components/auth/password-field';
import { PASSWORD_REQUIREMENTS } from '@/lib/auth/password-policy';
import type { ActionState } from '@/lib/auth/middleware';

type CompleteAction = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

export function PasswordCreateStep({
  action,
  actions,
  description,
  label = 'Create Password',
  submitLabel,
  submitPendingLabel = 'Please wait…',
  title,
}: {
  action: CompleteAction;
  actions?: ReactNode;
  description?: ReactNode;
  label?: string;
  submitLabel: string;
  submitPendingLabel?: string;
  title: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, { error: '' });
  const [password, setPassword] = useState('');
  const allMet = PASSWORD_REQUIREMENTS.every(({ test }) => test(password));

  return (
    <AuthShell description={description} title={title}>
      <form action={formAction} className="idoc-auth-form">
        <PasswordField
          autoComplete="new-password"
          label={label}
          onChange={setPassword}
          placeholder="Enter a strong password"
          value={password}
        />

        <ul className="idoc-auth-requirements" aria-label="Password requirements">
          {PASSWORD_REQUIREMENTS.map(({ key, label: requirementLabel, test }) => {
            const met = test(password);
            return (
              <li className={`idoc-auth-requirement${met ? ' idoc-auth-requirement--met' : ''}`} key={key}>
                <span aria-hidden className="idoc-auth-requirement__dot" />
                {requirementLabel}
              </li>
            );
          })}
        </ul>

        {state.error ? <p className="idoc-auth-error" role="alert">{state.error}</p> : null}

        <button className="idoc-auth-button" disabled={!allMet || pending} type="submit">
          {pending ? submitPendingLabel : submitLabel}
        </button>

        {actions ? <div className="idoc-auth-actions">{actions}</div> : null}
      </form>
    </AuthShell>
  );
}
