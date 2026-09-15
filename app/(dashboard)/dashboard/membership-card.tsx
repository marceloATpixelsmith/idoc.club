'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { cancelPendingRenewalAction, disableAutomaticRenewalAction, enableAutomaticRenewalAction, manageBillingAction } from '@/lib/payments/actions';

type Preference = { currentMode: string; effectiveOn: string | null; expectedChargeCents: number | null; pendingMode: string | null } | null;
type Action = typeof enableAutomaticRenewalAction;

function ActionButton({ action, children, newWindow = false, variant = 'default' }: {
  action: Action; children: ReactNode; newWindow?: boolean; variant?: 'default' | 'outline';
}) {
  const [state, submit, pending, dialog] = useFreshStepUpAction(action, {});
  // The Server Action is async, so by the time its redirectUrl comes back we're well past the
  // click's user-activation window -- a bare window.open() here would be silently popup-blocked.
  // Open the tab synchronously from the click instead, then point it at the real URL once known;
  // if the popup was blocked (or never captured), fall back to navigating the current tab.
  const popupRef = useRef<Window | null>(null);
  useEffect(() => {
    if (!state.redirectUrl) return;
    const popup = popupRef.current;
    if (newWindow && popup && !popup.closed) popup.location.href = String(state.redirectUrl);
    else window.location.assign(String(state.redirectUrl));
  }, [newWindow, state.redirectUrl]);
  return <><form action={submit} onSubmit={() => {
    if (!newWindow) return;
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;
    popupRef.current = popup;
  }}><CsrfField /><Button disabled={pending} type="submit" variant={variant}>
    {pending ? <AuthPendingLabel text="Submitting" /> : children}
  </Button>{state.error ? <p className="mt-2 text-sm text-red-400" role="alert">{state.error}</p> : null}
  {state.success ? <p className="mt-2 text-sm text-green-400" role="status">{state.success}</p> : null}</form>{dialog}</>;
}

export function MembershipCard({ canManageBilling, paidThroughDate, renewalCaption, renewalDate, showRenew, statusLabel, preference, recurring, typeIcon, typeLabel }: {
  canManageBilling: boolean;
  paidThroughDate: string | null;
  preference: Preference;
  recurring: boolean;
  renewalCaption: string | null;
  renewalDate: string | null;
  showRenew: boolean;
  statusLabel: string | null;
  typeIcon: ReactNode;
  typeLabel: string;
}) {
  const pending = preference?.pendingMode;
  return (
    <section className="mt-6 max-w-md space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold text-foreground">Membership</h2>
      <p className="text-sm text-foreground">Type: <span className="inline-flex items-center gap-2 align-middle text-2xl font-semibold tracking-tight text-gold">{typeIcon}{typeLabel}</span></p>

      {statusLabel ? <p className="text-sm text-foreground">Status: {statusLabel}</p> : null}
      {renewalDate ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-foreground">Renewal Date: {renewalDate}</p>
          {showRenew ? <Link href="/pricing"><Button size="sm">Renew</Button></Link> : null}
        </div>
      ) : null}
      {/* An early renewal (docs/02 §5) or an administrator's Extend Expiration Date correction can
       * push the paid-through date past the subscription's own next-charge date; when that happens,
       * Renewal Date alone would understate how long the membership is actually covered for. */}
      {paidThroughDate && paidThroughDate !== renewalDate ? <p className="text-sm text-foreground">Membership paid through: {paidThroughDate}</p> : null}
      {renewalDate ? <p className="text-sm text-foreground">Current renewal mode: {recurring ? 'Automatic renewal' : 'One-time renewal'}</p> : null}
      {renewalCaption ? <p className="text-sm text-muted-foreground">{renewalCaption}</p> : null}
      <p className="text-sm text-foreground">Annual membership: €80</p>

      {pending ? <div className="rounded-md bg-muted p-3 text-sm" role="status">
        Pending change: {pending === 'recurring' ? 'enable automatic renewal' : 'disable automatic renewal'} on {preference?.effectiveOn}.
        {preference?.expectedChargeCents ? <span> Expected charge: €{(preference.expectedChargeCents / 100).toFixed(2)}.</span> : null}
      </div> : null}

      <div className="flex flex-wrap gap-2">
        {canManageBilling ? <ActionButton action={manageBillingAction} newWindow variant="outline">Manage payment method</ActionButton> : null}
        {renewalDate ? (pending
          ? <ActionButton action={cancelPendingRenewalAction}>Cancel pending change</ActionButton>
          : recurring ? <ActionButton action={disableAutomaticRenewalAction}>Turn off automatic renewal</ActionButton>
            : <ActionButton action={enableAutomaticRenewalAction}>Turn on automatic renewal</ActionButton>) : null}
      </div>
    </section>
  );
}
