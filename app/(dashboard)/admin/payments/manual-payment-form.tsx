'use client';

import { useActionState, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nextValidUntil } from '@/lib/payments/renewal';
import { MANUAL_PAYMENT_SOURCES, PAYMENT_SOURCE_LABELS } from '@/lib/payments/pricing';
import { CsrfField } from '@/components/security/csrf-field';
import { recordManualPaymentForm } from './actions';

type ManualPaymentActionState = { error?: string; success?: string };

const today = () => new Date().toISOString().slice(0, 10);

export function ManualPaymentForm({ currentValidUntil, profileId }: { currentValidUntil: string | null; profileId: number }) {
  const [state, formAction, isPending] = useActionState<ManualPaymentActionState, FormData>(recordManualPaymentForm, {});
  const [paidAt, setPaidAt] = useState(today());
  const proposedValidUntil = nextValidUntil({ currentValidUntil, paidAt });

  return (
    <form action={formAction} className="mt-4 max-w-md space-y-4">
      <CsrfField />
      <input type="hidden" name="profileId" value={profileId} />
      <p className="text-sm text-foreground">Amount: <strong>€80.00</strong> — no partial, discounted, or waived payments.</p>
      <div>
        <label className="block text-sm font-medium text-foreground" htmlFor="source">Payment source</label>
        <select className="mt-1 block w-full rounded-md border-input" id="source" name="source" required>
          {MANUAL_PAYMENT_SOURCES.map((source) => <option key={source} value={source}>{PAYMENT_SOURCE_LABELS[source]}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground" htmlFor="paidAt">Paid date</label>
        <input
          className="mt-1 block w-full rounded-md border-input" id="paidAt" max={today()} name="paidAt" required type="date"
          value={paidAt} onChange={(event) => setPaidAt(event.target.value)}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground" htmlFor="reference">Reference / evidence (required for PayPal and bank transfer)</label>
        <input className="mt-1 block w-full rounded-md border-input" id="reference" name="reference" type="text" />
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground" htmlFor="reason">Reason</label>
        <textarea className="mt-1 block w-full rounded-md border-input" id="reason" name="reason" required rows={3} />
      </div>
      <p className="text-sm text-foreground">New paid-through date: <strong>{proposedValidUntil}</strong></p>
      <Button type="submit" disabled={isPending} className="rounded-full">
        {isPending ? <><Loader2 className="animate-spin mr-2 h-4 w-4" />Recording...</> : 'Record payment'}
      </Button>
      {state.error && <p className="text-red-400 text-sm">{state.error}</p>}
      {state.success && <p className="text-green-400 text-sm">{state.success}</p>}
    </form>
  );
}
