'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useActionState, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionState } from '@/lib/auth/middleware';
import { signIn } from '../actions';
import { cancelLogin } from './actions';

export function PasswordStep({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(signIn, { error: '' });
  const [visible, setVisible] = useState(false);
  const [, cancelAction] = useActionState<ActionState, FormData>(cancelLogin, { error: '' });

  return (
    <AuthShell description={<>Signing in as <span className="font-semibold text-gray-900">{email}</span>.</>} title="Enter your password">
      <form action={formAction} className="space-y-4">
        <input name="email" type="hidden" value={email} />
        <div>
          <Label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              autoComplete="current-password" autoFocus className="pr-10" id="password" name="password"
              placeholder="Enter your password" required type={visible ? 'text' : 'password'}
            />
            <button
              aria-label={visible ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-3 text-gray-500 hover:text-gray-700"
              onClick={() => setVisible((value) => !value)} type="button"
            >
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
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
