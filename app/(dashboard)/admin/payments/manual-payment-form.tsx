'use client';

import { useActionState, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { nextValidUntil } from '@/lib/payments/renewal';
import { MANUAL_PAYMENT_SOURCES, PAYMENT_SOURCE_LABELS } from '@/lib/payments/pricing';
import { CsrfField } from '@/components/security/csrf-field';
import { recordManualPaymentForm } from './actions';

type ManualPaymentActionState = { error?: string; success?: string };
const SELECT_CLASSNAME = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

const today = () => new Date().toISOString().slice(0, 10);

export function ManualPaymentForm({ currentValidUntil, profileId }: { currentValidUntil: string | null; profileId: number }) {
  const [state, formAction, isPending] = useActionState<ManualPaymentActionState, FormData>(recordManualPaymentForm, {});
  const [paidAt, setPaidAt] = useState(today());
  const proposedValidUntil = nextValidUntil({ currentValidUntil, paidAt });

  return (
    <form action={formAction} className="space-y-4">
      <CsrfField />
      <input type="hidden" name="profileId" value={profileId} />
      <p className="text-sm text-foreground">Amount: <strong>€80.00</strong> — no partial, discounted, or waived payments.</p>
      <div className="space-y-1.5">
        <Label htmlFor="source">Payment source</Label>
        <select className={SELECT_CLASSNAME} id="source" name="source" required>
          {MANUAL_PAYMENT_SOURCES.map((source) => <option key={source} value={source}>{PAYMENT_SOURCE_LABELS[source]}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="paidAt">Paid date</Label>
        <Input
          id="paidAt" max={today()} name="paidAt" required type="date"
          value={paidAt} onChange={(event) => setPaidAt(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reference">Reference / evidence (required for PayPal and bank transfer)</Label>
        <Input id="reference" name="reference" type="text" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason</Label>
        <Textarea id="reason" name="reason" required rows={3} />
      </div>
      <p className="text-sm text-foreground">New paid-through date: <strong>{proposedValidUntil}</strong></p>
      <Button type="submit" disabled={isPending}>
        {isPending ? <><Loader2 className="animate-spin mr-2 h-4 w-4" />Recording...</> : 'Record payment'}
      </Button>
      {state.error && <p className="text-red-400 text-sm">{state.error}</p>}
      {state.success && <p className="text-green-400 text-sm">{state.success}</p>}
    </form>
  );
}
