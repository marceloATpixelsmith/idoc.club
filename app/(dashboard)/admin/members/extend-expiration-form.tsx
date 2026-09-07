'use client';

import { useActionState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { extendExpirationForm } from './actions';

export function ExtendExpirationForm({ currentValidUntil, profileId }: { currentValidUntil: string; profileId: number }) {
  const [state, action, pending] = useActionState(extendExpirationForm, {} as { error?: string; success?: string });
  return <form action={action} className="mt-2 max-w-md space-y-2">
    <CsrfField />
    <input name="profileId" type="hidden" value={profileId} />
    <label className="block text-sm">New expiration date
      <input className="mt-1 block w-full border p-2" min={currentValidUntil} name="validUntil" required type="date" />
    </label>
    <label className="block text-sm">Administrator reason (required)
      <textarea className="mt-1 block w-full border p-2" name="reason" required rows={2} />
    </label>
    <button className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground" disabled={pending} type="submit">
      {pending ? <AuthPendingLabel text="Extending" /> : 'Extend Expiration Date'}
    </button>
    {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    {state.success && <p className="text-sm text-green-400">{state.success}</p>}
  </form>;
}
