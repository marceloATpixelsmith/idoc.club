'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { cancelPendingRenewalAction, disableAutomaticRenewalAction, enableAutomaticRenewalAction, manageBillingAction } from '@/lib/payments/actions';

type Preference = { currentMode: string; effectiveOn: string | null; expectedChargeCents: number | null; pendingMode: string | null } | null;
type Action = typeof enableAutomaticRenewalAction;

function ManageBillingButton() {
  const [state, submit, pending, dialog] = useFreshStepUpAction(manageBillingAction, {});
  // The Server Action is async, so by the time its redirectUrl comes back we're well past the
  // click's user-activation window -- a bare window.open() here would be silently popup-blocked.
  // Open the tab synchronously from the click instead, then point it at the real URL once known;
  // if the popup was blocked (or never captured), fall back to navigating the current tab.
  const popupRef = useRef<Window | null>(null);
  useEffect(() => {
    if (!state.redirectUrl) return;
    const popup = popupRef.current;
    if (popup && !popup.closed) popup.location.href = String(state.redirectUrl);
    else window.location.assign(String(state.redirectUrl));
  }, [state.redirectUrl]);
  return <><form action={submit} onSubmit={() => {
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;
    popupRef.current = popup;
  }}><CsrfField /><Button disabled={pending} type="submit">
    {pending ? <AuthPendingLabel text="Submitting" /> : 'Manage payment method'}
  </Button>{state.error ? <p className="mt-2 text-sm text-red-400" role="alert">{state.error}</p> : null}</form>{dialog}</>;
}

/** One radio option in the Renewal Mode control. Selecting it submits its own hidden form
 * immediately (no separate "save" button) -- `action` is whichever mutation actually moves the
 * member toward this option from wherever they currently stand (see MembershipCard). */
function RenewalModeOption({ action, checked, label }: { action: Action; checked: boolean; label: string }) {
  const [state, submit, pending, dialog] = useFreshStepUpAction(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state.redirectUrl) { window.location.assign(String(state.redirectUrl)); return; }
    if (state.success) router.refresh();
  }, [router, state.redirectUrl, state.success]);
  return <>
    <form action={submit} className="contents" ref={formRef}>
      <CsrfField />
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input checked={checked} className="cursor-pointer" disabled={pending}
          onChange={() => formRef.current?.requestSubmit()} type="radio" />
        {label}
      </label>
    </form>
    {state.error ? <p className="text-sm text-red-400" role="alert">{state.error}</p> : null}
    {dialog}
  </>;
}

export function MembershipCard({ canManageBilling, renewalDate, showRenew, statusLabel, preference, recurring, typeIcon, typeLabel }: {
  canManageBilling: boolean;
  preference: Preference;
  recurring: boolean;
  renewalDate: string | null;
  showRenew: boolean;
  statusLabel: string | null;
  typeIcon: ReactNode;
  typeLabel: string;
}) {
  const pendingMode = preference?.pendingMode ?? null;
  // A pending change (either direction) can only be reversed by cancelling it -- there's no direct
  // path from "cancel pending" straight to the opposite mode without first landing back where you
  // started, same as the single "Cancel pending change" button this control replaces.
  const toAutomatic = pendingMode ? cancelPendingRenewalAction : enableAutomaticRenewalAction;
  const toManual = pendingMode ? cancelPendingRenewalAction : disableAutomaticRenewalAction;
  const selection = pendingMode ?? (recurring ? 'recurring' : 'non_recurring');

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
      <p className="text-sm text-foreground">Annual membership: €80</p>

      {renewalDate ? (
        <fieldset className="space-y-1">
          <legend className="text-sm text-foreground">Renewal Mode</legend>
          <div className="flex items-center gap-4">
            <RenewalModeOption action={toAutomatic} checked={selection === 'recurring'} label="Automatic" />
            <RenewalModeOption action={toManual} checked={selection === 'non_recurring'} label="Manual" />
          </div>
          {pendingMode ? <p className="text-xs text-muted-foreground">Change takes effect on {preference?.effectiveOn}.</p> : null}
        </fieldset>
      ) : null}

      {canManageBilling ? <div className="flex flex-wrap gap-2"><ManageBillingButton /></div> : null}
    </section>
  );
}
