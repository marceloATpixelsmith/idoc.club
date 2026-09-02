'use client';

import { useActionState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { correctEntitlementForm } from './actions';

type FormState = { error?: string; success?: string };

const CORRECTABLE_STATUSES = ['active', 'grace', 'expired', 'canceled', 'complimentary', 'review_required'] as const;
const STATUS_LABELS: Record<string, string> = {
  active: 'Active', canceled: 'Canceled', complimentary: 'Complimentary',
  expired: 'Expired', grace: 'Payment grace period', review_required: 'Under review',
};

export function EntitlementCorrectionForm({ currentValidUntil, profileId }: { currentValidUntil: string | null; profileId: number }) {
  const [state, action, pending] = useActionState(correctEntitlementForm, {} as FormState);
  return <form action={action} className="mt-2 max-w-md space-y-2">
    <CsrfField />
    <input type="hidden" name="profileId" value={profileId} />
    <label className="block text-sm">New paid-through date
      <input className="mt-1 block w-full border p-2" defaultValue={currentValidUntil ?? ''} name="validUntil" type="date" />
    </label>
    <label className="block text-sm">New status
      <select className="mt-1 block w-full border p-2" defaultValue="" name="status">
        <option value="">No change</option>
        {CORRECTABLE_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
      </select>
    </label>
    <label className="block text-sm">Reason (required)<textarea className="mt-1 block w-full border p-2" name="reason" required rows={2} /></label>
    <button className="rounded bg-orange-600 px-3 py-1 text-sm text-white" disabled={pending} type="submit">Correct entitlement</button>
    {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    {state.success && <p className="text-sm text-green-700">{state.success}</p>}
  </form>;
}
