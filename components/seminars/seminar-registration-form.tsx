'use client';

import { useActionState, useEffect, useState } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { registerAsGuestForSeminarAction, type GuestSeminarState } from '@/app/(marketing)/seminars/actions';
import { registerForSeminarAction, type MemberSeminarState } from '@/app/(dashboard)/dashboard/seminars/actions';

const SELECT_CLASSNAME = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** The one seminar registration form, shared by a signed-in, entitled member (name/email pre-filled
 * and read-only from their own profile, paid via registerForSeminarAction at the member price) and
 * an anonymous guest (name/email are real inputs, paid via registerAsGuestForSeminarAction at the
 * non-member price, gated by Turnstile + a rate limit) -- both render the same layout, so a member
 * never sees a materially different form than the guest path they'd otherwise have used. Both
 * useActionState hooks are always called (React's rules of hooks); only the one matching the
 * current mode is ever wired to the visible form. */
export function SeminarRegistrationForm({ memberDetails, paymentMethods, seminarId }: {
  memberDetails?: { email: string; name: string };
  paymentMethods: Array<{ canonical_id: unknown; display_label: unknown }>;
  seminarId: number;
}) {
  const isMember = Boolean(memberDetails);
  const [memberState, memberFormAction, memberPending] = useActionState<MemberSeminarState, FormData>(registerForSeminarAction, {});
  const [guestState, guestFormAction, guestPending] = useActionState<GuestSeminarState, FormData>(registerAsGuestForSeminarAction, {});
  const [turnstileToken, setTurnstileToken] = useState('');
  // A submitted token is consumed server-side whether or not the attempt ultimately succeeds --
  // remount the widget (and restore the guest's typed name/email from the server-echoed state) on
  // every failed attempt so retrying starts from a fresh challenge without losing what they typed.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isMember && guestState.error) {
      setTurnstileToken('');
      setAttempt((value) => value + 1);
    }
  }, [guestState, isMember]);

  const state = isMember ? memberState : guestState;
  const pending = isMember ? memberPending : guestPending;
  const formAction = isMember ? memberFormAction : guestFormAction;
  const fieldErrors = !isMember ? guestState.fieldErrors : undefined;
  const hasFieldErrors = Boolean(fieldErrors && Object.values(fieldErrors).some(Boolean));

  if (state.success) return <p className="text-sm text-green-700" role="status">{state.success}</p>;

  return (
    <form action={formAction} className="space-y-4">
      <CsrfField />
      <input name="seminarId" type="hidden" value={seminarId} />
      <div className="grid gap-4 sm:grid-cols-2" key={attempt}>
        <div className="space-y-1.5">
          <Label htmlFor="registrantName">Full name</Label>
          <Input
            aria-invalid={Boolean(fieldErrors?.name)}
            defaultValue={isMember ? memberDetails?.name : guestState.name ?? ''}
            id="registrantName" maxLength={200} name={isMember ? undefined : 'name'} readOnly={isMember} required={!isMember}
          />
          {fieldErrors?.name ? <p className="text-sm text-destructive" role="alert">{fieldErrors.name}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="registrantEmail">Email</Label>
          <Input
            aria-invalid={Boolean(fieldErrors?.email)}
            defaultValue={isMember ? memberDetails?.email : guestState.email ?? ''}
            id="registrantEmail" maxLength={255} name={isMember ? undefined : 'email'} readOnly={isMember} required={!isMember} type="email"
          />
          {fieldErrors?.email ? <p className="text-sm text-destructive" role="alert">{fieldErrors.email}</p> : null}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="paymentMethod">Payment method</Label>
        <select className={SELECT_CLASSNAME} id="paymentMethod" name="paymentMethod" required>
          {paymentMethods.map((method) => <option key={String(method.canonical_id)} value={String(method.canonical_id)}>{String(method.display_label)}</option>)}
        </select>
        {fieldErrors?.paymentMethod ? <p className="text-sm text-destructive" role="alert">{fieldErrors.paymentMethod}</p> : null}
      </div>
      {isMember ? null : (
        <>
          <input name="turnstileToken" type="hidden" value={turnstileToken} />
          <TurnstileWidget action="seminar_guest_registration" key={attempt} onVerify={setTurnstileToken} theme="dark" />
        </>
      )}
      {state.error && !hasFieldErrors ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button className="w-full sm:w-auto" disabled={pending || (!isMember && !turnstileToken)} type="submit">
        {pending ? <AuthPendingLabel text="Registering" /> : 'Register'}
      </Button>
    </form>
  );
}
