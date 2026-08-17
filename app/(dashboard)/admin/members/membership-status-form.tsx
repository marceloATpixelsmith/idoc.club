'use client';

import { useActionState } from 'react';
import { reinstateMembershipForm, suspendMembershipForm } from './actions';

type FormState = { error?: string; success?: string };

export function SuspendForm({ profileId }: { profileId: number }) {
  const [state, action, pending] = useActionState(suspendMembershipForm, {} as FormState);
  return <form action={action} className="mt-2 max-w-md space-y-2">
    <input type="hidden" name="profileId" value={profileId} />
    <label className="block text-sm">Reason (required)<textarea className="mt-1 block w-full border p-2" name="reason" required rows={2} /></label>
    <button className="rounded bg-red-600 px-3 py-1 text-sm text-white" disabled={pending} type="submit">Suspend membership</button>
    {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    {state.success && <p className="text-sm text-green-700">{state.success}</p>}
  </form>;
}

const REINSTATE_STATUSES = ['active', 'grace', 'complimentary', 'canceled'] as const;
const REINSTATE_LABELS: Record<string, string> = {
  active: 'Active', canceled: 'Canceled', complimentary: 'Complimentary', grace: 'Payment grace period',
};

export function ReinstateForm({ profileId }: { profileId: number }) {
  const [state, action, pending] = useActionState(reinstateMembershipForm, {} as FormState);
  return <form action={action} className="mt-2 max-w-md space-y-2">
    <input type="hidden" name="profileId" value={profileId} />
    <label className="block text-sm">Restore to status
      <select className="mt-1 block w-full border p-2" defaultValue="active" name="status" required>
        {REINSTATE_STATUSES.map((status) => <option key={status} value={status}>{REINSTATE_LABELS[status]}</option>)}
      </select>
    </label>
    <label className="block text-sm">Reason (required)<textarea className="mt-1 block w-full border p-2" name="reason" required rows={2} /></label>
    <button className="rounded bg-green-700 px-3 py-1 text-sm text-white" disabled={pending} type="submit">Reinstate membership</button>
    {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    {state.success && <p className="text-sm text-green-700">{state.success}</p>}
  </form>;
}
