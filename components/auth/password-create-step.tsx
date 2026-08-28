'use client';

import type { ReactNode } from 'react';
import { useActionState, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { PasswordField } from '@/components/auth/password-field';
import { MAX_PASSWORD_LENGTH, PASSWORD_REQUIREMENTS } from '@/lib/auth/password-policy';
import type { ActionState } from '@/lib/auth/middleware';

type CompleteAction = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

export function PasswordCreateStep({
  action,
  actions,
  description,
  label = 'Create Password',
  submitLabel,
  submitPendingLabel = 'Please wait',
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
  const unmetRequirements = PASSWORD_REQUIREMENTS.filter(({ test }) => !test(password));
  const tooLong = password.length > MAX_PASSWORD_LENGTH;
  const allMet = unmetRequirements.length === 0 && !tooLong;

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

        {unmetRequirements.length > 0 ? (
          <ul className="idoc-auth-requirements" aria-label="Password requirements">
            {unmetRequirements.map(({ key, label: requirementLabel }) => (
              <li className="idoc-auth-requirement" key={key}>
                <span aria-hidden className="idoc-auth-requirement__dot" />
                {requirementLabel}
              </li>
            ))}
          </ul>
        ) : null}

        {tooLong ? <p className="idoc-auth-error" role="alert">Password must be 128 characters or fewer.</p> : null}
        {state.error ? <p className="idoc-auth-error" role="alert">{state.error}</p> : null}

        <button className="idoc-auth-button" disabled={!allMet || pending} type="submit">
          {pending ? <AuthPendingLabel text={submitPendingLabel} /> : submitLabel}
        </button>

        {actions ? <div className="idoc-auth-actions">{actions}</div> : null}
      </form>
    </AuthShell>
  );
}
