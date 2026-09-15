'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
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

/** One real native radio group (shared `name`, one `<form>`) so arrow-key navigation and a single
 * tab stop work the way assistive tech expects -- two separately-formed radios don't group. The
 * bound Server Action itself picks, from the submitted value and the member's current state,
 * whichever mutation actually moves them there (see MembershipCard for the state it closes over). */
function RenewalModeGroup({ dispatch, selection }: { dispatch: Action; selection: 'non_recurring' | 'recurring' }) {
  const [state, submit, pending, dialog] = useFreshStepUpAction(dispatch, {});
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state.redirectUrl) { window.location.assign(String(state.redirectUrl)); return; }
    if (state.success) router.refresh();
  }, [router, state.redirectUrl, state.success]);
  return <>
    <form action={submit} ref={formRef}>
      <CsrfField />
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input checked={selection === 'recurring'} className="cursor-pointer" disabled={pending} name="renewalMode"
            onChange={() => formRef.current?.requestSubmit()} type="radio" value="recurring" />
          Automatic
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input checked={selection === 'non_recurring'} className="cursor-pointer" disabled={pending} name="renewalMode"
            onChange={() => formRef.current?.requestSubmit()} type="radio" value="non_recurring" />
          Manual
        </label>
      </div>
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
  const selection: 'non_recurring' | 'recurring' = pendingMode === 'recurring' || pendingMode === 'non_recurring'
    ? pendingMode
    : recurring ? 'recurring' : 'non_recurring';
  // A pending change (either direction) can only be reversed by cancelling it -- there's no direct
  // path from "cancel pending" straight to the opposite mode without first landing back where you
  // started, same as the single "Cancel pending change" button this control replaces. Reading
  // pendingMode from the closure (rather than trusting the submitted value) keeps the routing
  // decision tied to the same server-rendered state the radios themselves reflect.
  const dispatchRenewalMode = useCallback((state: Parameters<Action>[0], formData: FormData) => {
    if (pendingMode) return cancelPendingRenewalAction(state, formData);
    return formData.get('renewalMode') === 'recurring'
      ? enableAutomaticRenewalAction(state, formData)
      : disableAutomaticRenewalAction(state, formData);
  }, [pendingMode]);

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
          <RenewalModeGroup dispatch={dispatchRenewalMode} selection={selection} />
          {pendingMode ? <p className="text-xs text-muted-foreground">Change takes effect on {preference?.effectiveOn}.</p> : null}
        </fieldset>
      ) : null}

      {canManageBilling ? <div className="flex flex-wrap gap-2"><ManageBillingButton /></div> : null}
    </section>
  );
}
