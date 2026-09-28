'use client';

import { useActionState, useEffect, useState } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { registerAsGuestForSeminarAction, type GuestSeminarState } from '@/app/(marketing)/seminars/actions';
import { registerAtNonMemberPriceAction, registerForSeminarAction, type MemberSeminarState } from '@/app/(dashboard)/dashboard/seminars/actions';

/** The one seminar registration form, shared by three registrants: a signed-in, entitled member
 * (name/email pre-filled and locked, paid via registerForSeminarAction at the member price); a
 * signed-in visitor with their own profile who cannot use the member price -- e.g. a lapsed
 * membership -- (name/email pre-filled and locked the same way, but paid via
 * registerAtNonMemberPriceAction, their own profileId at the non-member price, no Turnstile since
 * they're already authenticated); and an anonymous guest (name/email are real inputs, paid via
 * registerAsGuestForSeminarAction at the non-member price, gated by Turnstile + a rate limit). All
 * three render the same layout. Every useActionState hook is always called (React's rules of hooks);
 * only the one matching the current mode is ever wired to the visible form. */
export function SeminarRegistrationForm({ memberDetails, ownProfileDetails, paymentMethod, seminarId }: {
  memberDetails?: { email: string; name: string };
  ownProfileDetails?: { email: string; name: string };
  paymentMethod: string;
  seminarId: number;
}) {
  const isMember = Boolean(memberDetails);
  const isOwnProfileNonMember = Boolean(ownProfileDetails);
  const isLocked = isMember || isOwnProfileNonMember;
  const lockedDetails = memberDetails ?? ownProfileDetails;
  const [memberState, memberFormAction, memberPending] = useActionState<MemberSeminarState, FormData>(registerForSeminarAction, {});
  const [ownProfileState, ownProfileFormAction, ownProfilePending] = useActionState<MemberSeminarState, FormData>(registerAtNonMemberPriceAction, {});
  const [guestState, guestFormAction, guestPending] = useActionState<GuestSeminarState, FormData>(registerAsGuestForSeminarAction, {});
  const [turnstileToken, setTurnstileToken] = useState('');
  // A submitted token is consumed server-side whether or not the attempt ultimately succeeds --
  // remount the widget (and restore the guest's typed name/email from the server-echoed state) on
  // every failed attempt so retrying starts from a fresh challenge without losing what they typed.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isLocked && guestState.error) {
      setTurnstileToken('');
      setAttempt((value) => value + 1);
    }
  }, [guestState, isLocked]);

  const state = isMember ? memberState : isOwnProfileNonMember ? ownProfileState : guestState;
  const pending = isMember ? memberPending : isOwnProfileNonMember ? ownProfilePending : guestPending;
  const formAction = isMember ? memberFormAction : isOwnProfileNonMember ? ownProfileFormAction : guestFormAction;
  const fieldErrors = isLocked ? undefined : guestState.fieldErrors;
  const hasFieldErrors = Boolean(fieldErrors && Object.values(fieldErrors).some(Boolean));

  if (state.success) return <p className="text-sm text-green-700" role="status">{state.success}</p>;

  return (
    <form action={formAction} className="space-y-4">
      <CsrfField />
      <input name="seminarId" type="hidden" value={seminarId} />
      <input name="paymentMethod" type="hidden" value={paymentMethod} />
      <div className="grid gap-4 sm:grid-cols-2" key={attempt}>
        {isLocked ? <div className="space-y-1.5">
          <Label htmlFor="registrantName">Name</Label>
          <Input
            defaultValue={lockedDetails?.name}
            id="registrantName" readOnly
          />
        </div> : <>
          <div className="space-y-1.5"><Label htmlFor="guestFirstName">First name</Label><Input aria-invalid={Boolean(fieldErrors?.firstName)} defaultValue={guestState.firstName ?? ''} id="guestFirstName" maxLength={100} name="firstName" required />{fieldErrors?.firstName ? <p className="text-sm text-destructive" role="alert">{fieldErrors.firstName}</p> : null}</div>
          <div className="space-y-1.5"><Label htmlFor="guestLastName">Last name</Label><Input aria-invalid={Boolean(fieldErrors?.lastName)} defaultValue={guestState.lastName ?? ''} id="guestLastName" maxLength={100} name="lastName" required />{fieldErrors?.lastName ? <p className="text-sm text-destructive" role="alert">{fieldErrors.lastName}</p> : null}</div>
        </>}
        <div className="space-y-1.5">
          <Label htmlFor="registrantEmail">Email</Label>
          <Input
            aria-invalid={Boolean(fieldErrors?.email)}
            defaultValue={isLocked ? lockedDetails?.email : guestState.email ?? ''}
            id="registrantEmail" maxLength={255} name={isLocked ? undefined : 'email'} readOnly={isLocked} required={!isLocked} type="email"
          />
          {fieldErrors?.email ? <p className="text-sm text-destructive" role="alert">{fieldErrors.email}</p> : null}
        </div>
        {isLocked ? null : <div className="space-y-1.5"><Label htmlFor="guestPhone">Phone</Label><Input aria-invalid={Boolean(fieldErrors?.phone)} defaultValue={guestState.phone ?? ''} id="guestPhone" maxLength={40} name="phone" required type="tel" />{fieldErrors?.phone ? <p className="text-sm text-destructive" role="alert">{fieldErrors.phone}</p> : null}</div>}
      </div>
      {isLocked ? null : (
        <>
          <input name="turnstileToken" type="hidden" value={turnstileToken} />
          <TurnstileWidget action="seminar_guest_registration" key={attempt} onVerify={setTurnstileToken} theme="dark" />
        </>
      )}
      {state.error && !hasFieldErrors ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button className="w-full sm:w-auto" disabled={pending || (!isLocked && !turnstileToken)} type="submit">
        {pending ? <AuthPendingLabel text="Registering" /> : 'Register'}
      </Button>
    </form>
  );
}
