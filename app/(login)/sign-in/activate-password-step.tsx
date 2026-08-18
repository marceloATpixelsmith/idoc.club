'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useActionState, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PASSWORD_REQUIREMENTS } from '@/lib/auth/password-policy';
import type { ActionState } from '@/lib/auth/middleware';
import { activateLegacyAccount } from './actions';

export function ActivatePasswordStep() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(activateLegacyAccount, { error: '' });
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const allMet = PASSWORD_REQUIREMENTS.every(({ test }) => test(password));

  return (
    <AuthShell description="Your email is verified. Set a new password to finish activating your account." title="Set your password">
      <form action={formAction} className="space-y-4">
        <div>
          <Label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="password">New password</Label>
          <div className="relative">
            <Input
              autoComplete="new-password" className="pr-10" id="password" name="password"
              onChange={(event) => setPassword(event.target.value)} placeholder="Enter a strong password"
              required type={visible ? 'text' : 'password'} value={password}
            />
            <button
              aria-label={visible ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-700"
              onClick={() => setVisible((value) => !value)} type="button"
            >
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <ul className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          {PASSWORD_REQUIREMENTS.map(({ key, label, test }) => {
            const met = test(password);
            return (
              <li className={met ? 'flex items-center gap-2 text-green-700' : 'flex items-center gap-2 text-gray-500'} key={key}>
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${met ? 'bg-green-600' : 'bg-gray-300'}`} />
                {label}
              </li>
            );
          })}
        </ul>
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <Button className="w-full" disabled={!allMet || pending} size="lg" type="submit">
          {pending ? 'Please wait…' : 'Activate account'}
        </Button>
      </form>
    </AuthShell>
  );
}
