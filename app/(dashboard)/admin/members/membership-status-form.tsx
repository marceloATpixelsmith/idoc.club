'use client';

import { useActionState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { reinstateMembershipForm, suspendMembershipForm } from './actions';

type FormState = { error?: string; success?: string };
const SELECT_CLASSNAME = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

export function SuspendForm({ profileId }: { profileId: number }) {
  const [state, action, pending] = useActionState(suspendMembershipForm, {} as FormState);
  return <form action={action} className="space-y-4">
    <CsrfField />
    <input type="hidden" name="profileId" value={profileId} />
    <div className="space-y-1.5">
      <Label htmlFor="suspend-membership-reason">Reason (required)</Label>
      <Textarea id="suspend-membership-reason" name="reason" required rows={2} />
    </div>
    <Button disabled={pending} type="submit" variant="destructive">Suspend membership</Button>
    {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    {state.success && <p className="text-sm text-green-400">{state.success}</p>}
  </form>;
}

const REINSTATE_STATUSES = ['active', 'grace', 'complimentary', 'canceled'] as const;
const REINSTATE_LABELS: Record<string, string> = {
  active: 'Active', canceled: 'Canceled', complimentary: 'Complimentary', grace: 'Payment grace period',
};

export function ReinstateForm({ profileId }: { profileId: number }) {
  const [state, action, pending] = useActionState(reinstateMembershipForm, {} as FormState);
  return <form action={action} className="space-y-4">
    <CsrfField />
    <input type="hidden" name="profileId" value={profileId} />
    <div className="space-y-1.5">
      <Label htmlFor="reinstate-membership-status">Restore to status</Label>
      <select className={SELECT_CLASSNAME} defaultValue="active" id="reinstate-membership-status" name="status" required>
        {REINSTATE_STATUSES.map((status) => <option key={status} value={status}>{REINSTATE_LABELS[status]}</option>)}
      </select>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="reinstate-membership-reason">Reason (required)</Label>
      <Textarea id="reinstate-membership-reason" name="reason" required rows={2} />
    </div>
    <Button disabled={pending} type="submit">Reinstate membership</Button>
    {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    {state.success && <p className="text-sm text-green-400">{state.success}</p>}
  </form>;
}
