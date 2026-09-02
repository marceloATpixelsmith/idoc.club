'use client';

import { useActionState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { reinstateUserAccountForm, suspendUserAccountForm } from './actions';

type FormState = { error?: string; success?: string };

export function SuspendAccountForm({ userId }: { userId: number }) {
  const [state, action, pending] = useActionState(suspendUserAccountForm, {} as FormState);
  return <form action={action} className="mt-2 max-w-md space-y-2">
    <CsrfField />
    <input type="hidden" name="userId" value={userId} />
    <p className="text-sm text-gray-700">Immediately blocks this user from signing in and revokes all active sessions and remembered devices.</p>
    <label className="block text-sm">Reason (required)<textarea className="mt-1 block w-full border p-2" name="reason" required rows={2} /></label>
    <button className="rounded bg-red-600 px-3 py-1 text-sm text-white" disabled={pending} type="submit">Suspend account</button>
    {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    {state.success && <p className="text-sm text-green-700">{state.success}</p>}
  </form>;
}

const REINSTATE_ACCOUNT_STATES = ['active', 'onboarding', 'migrated_pending'] as const;
const REINSTATE_ACCOUNT_LABELS: Record<string, string> = {
  active: 'Active', migrated_pending: 'Migrated (pending verification)', onboarding: 'Onboarding',
};

export function ReinstateAccountForm({ userId }: { userId: number }) {
  const [state, action, pending] = useActionState(reinstateUserAccountForm, {} as FormState);
  return <form action={action} className="mt-2 max-w-md space-y-2">
    <CsrfField />
    <input type="hidden" name="userId" value={userId} />
    <label className="block text-sm">Restore to state
      <select className="mt-1 block w-full border p-2" defaultValue="active" name="accountState" required>
        {REINSTATE_ACCOUNT_STATES.map((state) => <option key={state} value={state}>{REINSTATE_ACCOUNT_LABELS[state]}</option>)}
      </select>
    </label>
    <label className="block text-sm">Reason (required)<textarea className="mt-1 block w-full border p-2" name="reason" required rows={2} /></label>
    <button className="rounded bg-green-700 px-3 py-1 text-sm text-white" disabled={pending} type="submit">Reinstate account</button>
    {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    {state.success && <p className="text-sm text-green-700">{state.success}</p>}
  </form>;
}
