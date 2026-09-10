'use client';

import { useEffect } from 'react';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { cancelPendingRenewalAction, disableAutomaticRenewalAction, enableAutomaticRenewalAction } from '@/lib/payments/actions';

type Preference = { currentMode: string; effectiveOn: string | null; expectedChargeCents: number | null; pendingMode: string | null } | null;

function BillingButton({ action, children, variant = 'default' }: { action: typeof enableAutomaticRenewalAction; children: React.ReactNode; variant?: 'default' | 'outline' }) {
  const [state, submit, pending, dialog] = useFreshStepUpAction(action, {});
  useEffect(() => { if (state.redirectUrl) window.location.assign(String(state.redirectUrl)); }, [state.redirectUrl]);
  return <><form action={submit}><CsrfField /><Button disabled={pending} type="submit" variant={variant}>
    {pending ? <AuthPendingLabel text="Submitting" /> : children}
  </Button>{state.error ? <p className="mt-2 text-sm text-red-400" role="alert">{state.error}</p> : null}
  {state.success ? <p className="mt-2 text-sm text-green-400" role="status">{state.success}</p> : null}</form>{dialog}</>;
}

export function BillingSettings({ paidThrough, preference, recurring }: { paidThrough: string; preference: Preference; recurring: boolean }) {
  const pending = preference?.pendingMode;
  return <section className="mt-6 max-w-md space-y-3 rounded-lg border p-4">
    <h2 className="font-semibold">Billing settings</h2>
    <p className="text-sm">Annual membership: €80</p>
    <p className="text-sm">Paid through: {paidThrough}</p>
    <p className="text-sm">Current renewal mode: {recurring ? 'Automatic renewal' : 'One-time renewal'}</p>
    {pending ? <div className="rounded-md bg-muted p-3 text-sm" role="status">
      Pending change: {pending === 'recurring' ? 'enable automatic renewal' : 'disable automatic renewal'} on {preference?.effectiveOn}.
      {preference?.expectedChargeCents ? <span> Expected charge: €{(preference.expectedChargeCents / 100).toFixed(2)}.</span> : null}
    </div> : null}
    <div className="flex flex-wrap gap-2">
      {pending ? <BillingButton action={cancelPendingRenewalAction}>Cancel pending change</BillingButton>
        : recurring ? <BillingButton action={disableAutomaticRenewalAction}>Turn off automatic renewal</BillingButton>
          : <BillingButton action={enableAutomaticRenewalAction}>Turn on automatic renewal</BillingButton>}
    </div>
  </section>;
}
