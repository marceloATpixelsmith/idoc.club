'use client';

import type { ReactNode } from 'react';
import { useActionState, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordField } from '@/components/auth/password-field';
import { Button } from '@/components/ui/button';
import { PASSWORD_REQUIREMENTS } from '@/lib/auth/password-policy';
import type { ActionState } from '@/lib/auth/middleware';

type CompleteAction = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

/** Shared "create a new password" step reused by signup, legacy-member login activation, and
 * password reset: identical requirements checklist, visibility toggle, and submit-disabled-until-met
 * behavior across all three. What differs is purely which Server Action gets the password and what
 * it does with it, plus the title/description/submit-button copy. */
export function PasswordCreateStep({
  action, description, label = 'New password', submitLabel, submitPendingLabel = 'Please wait…', title,
}: {
  action: CompleteAction;
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
      <form action={formAction} className="space-y-4">
        <PasswordField autoComplete="new-password" label={label} onChange={setPassword} placeholder="Enter a strong password" value={password} />
        <ul className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          {PASSWORD_REQUIREMENTS.map(({ key, label: requirementLabel, test }) => {
            const met = test(password);
            return (
              <li className={met ? 'flex items-center gap-2 text-green-700' : 'flex items-center gap-2 text-gray-500'} key={key}>
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${met ? 'bg-green-600' : 'bg-gray-300'}`} />
                {requirementLabel}
              </li>
            );
          })}
        </ul>
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <Button className="w-full" disabled={!allMet || pending} size="lg" type="submit">
          {pending ? submitPendingLabel : submitLabel}
        </Button>
      </form>
    </AuthShell>
  );
}
