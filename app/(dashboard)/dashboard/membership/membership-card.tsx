'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cancelPendingRenewalAction, disableAutomaticRenewalAction, enableAutomaticRenewalAction } from '@/lib/payments/actions';
import { cancelMembershipAction } from './membership-actions';

type Preference = { currentMode: string; effectiveOn: string | null; expectedChargeCents: number | null; pendingMode: string | null } | null;
type Action = typeof enableAutomaticRenewalAction;

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
    {state.error ? <p className="mt-2 text-sm text-red-400" role="alert">{state.error}</p> : null}
    {dialog}
  </>;
}

/** Distinct from, and never triggered by, the Renewal Mode control above -- this ends access
 * immediately rather than just stopping future billing, so it gets its own explicit confirmation
 * naming exactly what happens before anything is submitted. */
function CancelMembershipButton() {
  const [state, submit, pending, dialog] = useFreshStepUpAction(cancelMembershipAction, {});
  const [confirmOpen, setConfirmOpen] = useState(false);
  return <>
    <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
      <DialogTrigger asChild><Button type="button">Cancel membership</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel your membership?</DialogTitle>
          <DialogDescription>
            This ends your membership immediately, removes you from the mailing list, and signs you out of every device. It does not delete your account or login -- you can sign back in later, but your membership will show as canceled.
          </DialogDescription>
        </DialogHeader>
        <form action={submit}>
          <CsrfField />
          {state.error ? <p className="text-sm text-red-400" role="alert">{state.error}</p> : null}
          <DialogFooter className="mt-2">
            <DialogClose asChild><Button type="button" variant="outline">Keep my membership</Button></DialogClose>
            <Button disabled={pending} type="submit">{pending ? <AuthPendingLabel text="Canceling" /> : 'Yes, cancel my membership'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {dialog}
  </>;
}

export function MembershipCard({ renewalDate, showRenew, statusLabel, preference, recurring, typeIcon, typeLabel }: {
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
    <section className="mt-6 max-w-md rounded-lg border p-5">
      <h2 className="text-lg font-bold uppercase tracking-wider text-gold">Membership</h2>

      <dl className="mt-4 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-3 text-sm">
        <dt className="font-semibold text-foreground">Type</dt>
        <dd className="flex items-center gap-2 text-xl font-semibold text-gold">{typeIcon}{typeLabel}</dd>

        {statusLabel ? <><dt className="font-semibold text-foreground">Status</dt><dd className="text-foreground">{statusLabel}</dd></> : null}

        {renewalDate ? <>
          <dt className="font-semibold text-foreground">Renewal Date</dt>
          <dd className="flex flex-wrap items-center justify-between gap-3 text-foreground">
            <span>{renewalDate}</span>
            {showRenew ? <Link href="/dashboard/membership?renew=1"><Button size="sm">Renew</Button></Link> : null}
          </dd>
        </> : null}

        <dt className="font-semibold text-foreground">Annual Fee</dt>
        <dd className="text-foreground">€80 / year</dd>
      </dl>

      {renewalDate ? (
        <fieldset className="mt-5 space-y-2 border-t border-border pt-4">
          <legend className="text-sm font-bold uppercase tracking-wider text-gold">Renewal Mode</legend>
          <RenewalModeGroup dispatch={dispatchRenewalMode} selection={selection} />
          <p className="text-xs text-muted-foreground">
            {selection === 'recurring'
              ? `(Your membership will automatically renew on ${renewalDate}.)`
              : `(Your membership will expire on ${renewalDate}.)`}
          </p>
          {pendingMode ? <p className="text-xs text-muted-foreground">Change takes effect on {preference?.effectiveOn}.</p> : null}
        </fieldset>
      ) : null}

      {renewalDate ? (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
          <CancelMembershipButton />
        </div>
      ) : null}
    </section>
  );
}
