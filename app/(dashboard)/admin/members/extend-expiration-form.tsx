'use client';

import { useActionState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { extendExpirationForm } from './actions';

export function ExtendExpirationForm({ currentValidUntil, profileId }: { currentValidUntil: string; profileId: number }) {
  const [state, action, pending] = useActionState(extendExpirationForm, {} as { error?: string; success?: string });
  return <form action={action} className="space-y-4">
    <CsrfField />
    <input name="profileId" type="hidden" value={profileId} />
    <div className="space-y-1.5">
      <Label htmlFor="extend-validUntil">New expiration date</Label>
      <Input id="extend-validUntil" min={currentValidUntil} name="validUntil" required type="date" />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="extend-reason">Administrator reason (required)</Label>
      <Textarea id="extend-reason" name="reason" required rows={2} />
    </div>
    <Button disabled={pending} type="submit">
      {pending ? <AuthPendingLabel text="Extending" /> : 'Extend Expiration Date'}
    </Button>
    {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    {state.success && <p className="text-sm text-green-400">{state.success}</p>}
  </form>;
}
