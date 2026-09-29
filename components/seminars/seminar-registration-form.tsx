'use client';

import { useActionState, useEffect, useState } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InternationalPhoneInput } from '@/components/ui/international-phone-input';
import { Label } from '@/components/ui/label';
import { guestContactSchema } from '@/lib/seminars/guest-registration-validation';
import { registerAsGuestForSeminarAction, type GuestSeminarState } from '@/app/(marketing)/seminars/actions';

/** anonymous-only contact form for guest bank-transfer/cash registrations. */
export function SeminarRegistrationForm({ paymentMethod, seminarId }: {
  paymentMethod: string;
  seminarId: number;
}) {
  const [guestState, guestFormAction, guestPending] = useActionState<GuestSeminarState, FormData>(registerAsGuestForSeminarAction, {});
  const [turnstileToken, setTurnstileToken] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (guestState.error) {
      setTurnstileToken('');
      setAttempt((value) => value + 1);
    }
  }, [guestState]);

  const fieldErrors = guestState.fieldErrors;
  const hasFieldErrors = Boolean(fieldErrors && Object.values(fieldErrors).some(Boolean));
  const formIsValid = guestContactSchema.safeParse({ email, firstName, lastName, phone }).success;
  const emailIsValid = guestContactSchema.shape.email.safeParse(email).success;
  const showEmailError = emailTouched && !emailIsValid;

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">Register</h2>
        {!guestState.success ? (
          <p className="mt-1 text-sm text-muted-foreground">Enter your contact details to complete your seminar registration.</p>
        ) : null}
      </div>

      {guestState.success ? (
        <p className="text-xl font-semibold leading-relaxed text-white" role="status">{guestState.success}</p>
      ) : (
        <form action={guestFormAction} className="space-y-4">
          <CsrfField />
          <input name="seminarId" type="hidden" value={seminarId} />
          <input name="paymentMethod" type="hidden" value={paymentMethod} />

          <div className="space-y-1.5">
            <Label htmlFor="guestFirstName">First name</Label>
            <Input aria-invalid={Boolean(fieldErrors?.firstName)} id="guestFirstName" maxLength={100} name="firstName" onChange={(event) => setFirstName(event.target.value)} required value={firstName} />
            {fieldErrors?.firstName ? <p className="text-sm text-destructive" role="alert">{fieldErrors.firstName}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guestLastName">Last name</Label>
            <Input aria-invalid={Boolean(fieldErrors?.lastName)} id="guestLastName" maxLength={100} name="lastName" onChange={(event) => setLastName(event.target.value)} required value={lastName} />
            {fieldErrors?.lastName ? <p className="text-sm text-destructive" role="alert">{fieldErrors.lastName}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="registrantEmail">Email</Label>
            <Input
              aria-describedby={showEmailError ? 'registrantEmailError' : undefined}
              aria-invalid={showEmailError || Boolean(fieldErrors?.email)}
              id="registrantEmail"
              maxLength={255}
              name="email"
              onBlur={() => setEmailTouched(true)}
              onChange={(event) => {
                setEmail(event.target.value);
                if (emailTouched) setEmailTouched(true);
              }}
              required
              type="email"
              value={email}
            />
            {showEmailError ? <p className="text-sm text-destructive" id="registrantEmailError" role="alert">Enter a complete, valid email address.</p> : fieldErrors?.email ? <p className="text-sm text-destructive" role="alert">{fieldErrors.email}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guestPhone">Phone</Label>
            <InternationalPhoneInput id="guestPhone" name="phone" onChange={setPhone} required value={phone} />
            {fieldErrors?.phone ? <p className="text-sm text-destructive" role="alert">{fieldErrors.phone}</p> : null}
          </div>

          <input name="turnstileToken" type="hidden" value={turnstileToken} />
          <TurnstileWidget action="seminar_guest_registration" key={attempt} onVerify={setTurnstileToken} theme="dark" />
          {guestState.error && !hasFieldErrors ? <p className="text-sm text-destructive" role="alert">{guestState.error}</p> : null}
          <Button className="w-full sm:w-auto" disabled={guestPending || !formIsValid || !turnstileToken} type="submit">
            {guestPending ? <AuthPendingLabel text="Registering" /> : 'Register'}
          </Button>
        </form>
      )}
    </div>
  );
}
