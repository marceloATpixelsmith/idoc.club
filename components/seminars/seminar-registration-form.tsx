'use client';

import { useActionState, useEffect, useState } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { registerAsGuestForSeminarAction, type GuestSeminarState } from '@/app/(marketing)/seminars/actions';

/** This form is intentionally anonymous-only. Authenticated visitors are registered from their
 * server-side profile immediately after choosing a payment method. Anonymous Stripe visitors go
 * directly to Checkout. Therefore this UI exists only for anonymous bank transfer/cash. */
export function SeminarRegistrationForm({ paymentMethod, seminarId }: {
  paymentMethod: string;
  seminarId: number;
}) {
  const [guestState, guestFormAction, guestPending] = useActionState<GuestSeminarState, FormData>(registerAsGuestForSeminarAction, {});
  const [turnstileToken, setTurnstileToken] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (guestState.error) {
      setTurnstileToken('');
      setAttempt((value) => value + 1);
    }
  }, [guestState]);

  const fieldErrors = guestState.fieldErrors;
  const hasFieldErrors = Boolean(fieldErrors && Object.values(fieldErrors).some(Boolean));

  if (guestState.success) return <p className="text-sm text-green-700" role="status">{guestState.success}</p>;

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">Register</h2>
        <p className="mt-1 text-sm text-muted-foreground">Enter your contact details to complete your seminar registration.</p>
      </div>
      <form action={guestFormAction} className="space-y-4">
        <CsrfField />
        <input name="seminarId" type="hidden" value={seminarId} />
        <input name="paymentMethod" type="hidden" value={paymentMethod} />
        <div className="grid gap-4 sm:grid-cols-2" key={attempt}>
          <div className="space-y-1.5"><Label htmlFor="guestFirstName">First name</Label><Input aria-invalid={Boolean(fieldErrors?.firstName)} defaultValue={guestState.firstName ?? ''} id="guestFirstName" maxLength={100} name="firstName" required />{fieldErrors?.firstName ? <p className="text-sm text-destructive" role="alert">{fieldErrors.firstName}</p> : null}</div>
          <div className="space-y-1.5"><Label htmlFor="guestLastName">Last name</Label><Input aria-invalid={Boolean(fieldErrors?.lastName)} defaultValue={guestState.lastName ?? ''} id="guestLastName" maxLength={100} name="lastName" required />{fieldErrors?.lastName ? <p className="text-sm text-destructive" role="alert">{fieldErrors.lastName}</p> : null}</div>
          <div className="space-y-1.5">
            <Label htmlFor="registrantEmail">Email</Label>
            <Input aria-invalid={Boolean(fieldErrors?.email)} defaultValue={guestState.email ?? ''} id="registrantEmail" maxLength={255} name="email" required type="email" />
            {fieldErrors?.email ? <p className="text-sm text-destructive" role="alert">{fieldErrors.email}</p> : null}
          </div>
          <div className="space-y-1.5"><Label htmlFor="guestPhone">Phone</Label><Input aria-invalid={Boolean(fieldErrors?.phone)} defaultValue={guestState.phone ?? ''} id="guestPhone" maxLength={40} name="phone" required type="tel" />{fieldErrors?.phone ? <p className="text-sm text-destructive" role="alert">{fieldErrors.phone}</p> : null}</div>
        </div>
        <input name="turnstileToken" type="hidden" value={turnstileToken} />
        <TurnstileWidget action="seminar_guest_registration" key={attempt} onVerify={setTurnstileToken} theme="dark" />
        {guestState.error && !hasFieldErrors ? <p className="text-sm text-destructive" role="alert">{guestState.error}</p> : null}
        <Button className="w-full sm:w-auto" disabled={guestPending || !turnstileToken} type="submit">
          {guestPending ? <AuthPendingLabel text="Registering" /> : 'Register'}
        </Button>
      </form>
    </div>
  );
}
