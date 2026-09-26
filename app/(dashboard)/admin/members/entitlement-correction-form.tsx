'use client';

import { useActionState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { correctEntitlementForm } from './actions';

type FormState = { error?: string; success?: string };

const CORRECTABLE_STATUSES = ['active', 'grace', 'expired', 'canceled', 'complimentary', 'review_required'] as const;
const STATUS_LABELS: Record<string, string> = {
  active: 'Active', canceled: 'Canceled', complimentary: 'Complimentary',
  expired: 'Expired', grace: 'Payment grace period', review_required: 'Under review',
};
const SELECT_CLASSNAME = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

export function EntitlementCorrectionForm({ currentValidUntil, profileId }: { currentValidUntil: string | null; profileId: number }) {
  const [state, action, pending] = useActionState(correctEntitlementForm, {} as FormState);
  return <form action={action} className="space-y-4">
    <CsrfField />
    <input type="hidden" name="profileId" value={profileId} />
    <div className="space-y-1.5">
      <Label htmlFor="correct-validUntil">New paid-through date</Label>
      <Input defaultValue={currentValidUntil ?? ''} id="correct-validUntil" name="validUntil" type="date" />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="correct-status">New status</Label>
      <select className={SELECT_CLASSNAME} defaultValue="" id="correct-status" name="status">
        <option value="">No change</option>
        {CORRECTABLE_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
      </select>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="correct-reason">Reason (required)</Label>
      <Textarea id="correct-reason" name="reason" required rows={2} />
    </div>
    <Button disabled={pending} type="submit">Correct entitlement</Button>
    {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    {state.success && <p className="text-sm text-green-400">{state.success}</p>}
  </form>;
}
