'use client';

import type { ReactNode } from 'react';
import { useActionState, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TurnstileWidget } from '@/components/turnstile-widget';
import type { ActionState } from '@/lib/auth/middleware';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type EmailAction = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

/** Shared email-entry step reused by signup, login, and password reset. Each flow supplies a stable
 * Turnstile action that the trusted server independently expects during Siteverify. */
export function EmailEntryStep({
  action, below, description, footer, submitLabel, title, turnstileAction,
}: {
  action: EmailAction;
  below?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  submitLabel: string;
  title: string;
  turnstileAction: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, { error: '' });
  const [email, setEmail] = useState(state.email ?? '');
  const [turnstileToken, setTurnstileToken] = useState('');
  const canSubmit = EMAIL_PATTERN.test(email) && turnstileToken.length > 0 && !pending;

  return (
    <AuthShell description={description} title={title}>
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
        <TurnstileWidget action={turnstileAction} onVerify={setTurnstileToken} />
        <Button className="w-full" disabled={!canSubmit} size="lg" type="submit">
          {pending ? 'Please wait…' : submitLabel}
        </Button>
        {footer ? <p className="text-center text-sm text-gray-600">{footer}</p> : null}
      </form>
      {below}
    </AuthShell>
  );
}
